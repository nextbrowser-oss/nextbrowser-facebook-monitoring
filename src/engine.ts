// One monitoring pass: who is signed in, what is new in each watched group,
// which of those posts name a keyword or mention the account, which comments
// landed under the posts that concern the account, and how urgent each one
// is.
//
// The pass is a state machine over an explicit MonitorState, like the X,
// Reddit and Instagram monitors: state in, next state and events out, nothing
// mutated. The caller persists the state and schedules the next pass.
//
// Everything is read, nothing is done: no reaction, no comment, no reply, no
// join, not even a click on "See more". Answering is the reply agent's job,
// with the person's approval.
//
// Facebook is read from the pages it draws, which makes every read a page
// load, and Facebook is quick to block an account that loads pages like a
// script. So the pass is slow on purpose: a pause of four to nine seconds
// before every page, a few seconds between scrolls, a handful of scrolls per
// group, and a handful of posts opened for their comments per pass.

import type { MonitorBrowser } from "./browser.js";
import { commentCount } from "./counts.js";
import type { ItemSource, Match, MonitorEvent } from "./events.js";
import { feedUrl, groupKey, mobileFeedUrl } from "./ids.js";
import {
  commentItem,
  commentKey,
  groupContext,
  isOwn,
  mentionsAccount,
  normalizePosts,
  postItem,
  type Account,
  type Addressed,
  type GroupContext,
  type GroupPost,
} from "./items.js";
import { keywordMatcher, type Matcher } from "./keywords.js";
import { errorText, makeLogger, type LogSink, type Logger } from "./log.js";
import { defaultSleep, loadPage, waitForElement, type Sleep } from "./page.js";
import {
  FEED_READY_SELECTOR,
  HOME_READY_SELECTOR,
  MOBILE_READY_SELECTOR,
  SIGN_IN_URL,
  THREAD_READY_SELECTOR,
  groupFeedScript,
  identityScript,
  mobileGroupScript,
  scrollScript,
  threadScript,
  type FeedSnapshot,
  type Gate,
  type IdentitySnapshot,
  type PageHealth,
  type ScrollState,
  type ThreadSnapshot,
} from "./scripts.js";
import {
  MAX_PASS_NOTES,
  MAX_POSTS_WATCHED,
  MAX_SEEN,
  normalizeState,
  type MonitorState,
  type PostWatch,
  type SourceState,
} from "./state.js";
import { drawnTimeRange, type TimeRange } from "./times.js";
import { byUrgency, triage } from "./triage.js";

export { defaultSleep, type Sleep } from "./page.js";

const BLANK_PAGE = "about:blank";
/** How many already-seen posts a read must pass before it is sure it is back
 *  in ground the last pass covered. One is usually enough in a chronological
 *  feed; three keeps a single post Facebook drew out of order from ending the
 *  read early. */
/** How far a group's first read scrolls: it announces nothing, but the
 *  matches it lists are what the panel shows after Start. */
const BASELINE_SCROLLS = 2;
const KNOWN_TO_STOP = 3;
/** How many scrolls in a row may bring nothing before the feed is taken to
 *  have ended. */
const MAX_STALLS = 2;
/** How long a post's page may take to draw its comments. Shorter than a
 *  feed's wait: a post with its comments collapsed draws none, and that is not
 *  worth twenty seconds. */
const THREAD_WAIT_MS = 12_000;
/** How many reads in a row may draw fewer new comments than a post's count
 *  grew by before the count is taken as read. Facebook's count takes in
 *  replies, which are not read, and comments its "Most relevant" order leaves
 *  out; neither will ever be drawn, and a post must not be opened forever. */
const MAX_SHORT_READS = 3;

export interface PassDeps {
  browser: MonitorBrowser;
  state: MonitorState;
  now?: () => number;
  sleep?: Sleep;
  /** A source of numbers in [0, 1), for the pauses a person would take. */
  random?: () => number;
  log?: LogSink;
  /** Called for every event as it happens, before the pass returns. */
  onEvent?: (event: MonitorEvent) => void;
  /** Called with what the pass is doing, for a status line. */
  onStep?: (step: string) => void;
  /** Checked between pages, so Stop ends the pass instead of waiting it out. */
  shouldStop?: () => boolean;
}

export interface PassSummary {
  signedIn: boolean;
  /** The signed-in account's name, when Facebook drew it. */
  account?: string;
  /** The profile is not signed in to Facebook, so no group could be read. */
  loginRequired: boolean;
  /** Facebook stopped the session at a security check. Someone has to open
   *  facebook.com in the profile and complete it. */
  securityCheck: boolean;
  /** Facebook is blocking the account ("You're Temporarily Blocked"), and the
   *  pass stopped. */
  rateLimited: boolean;
  /** Why the pass stopped reading, when it did. The next pass should back
   *  off. */
  blocked?: string;
  /** Pages opened on facebook.com. */
  pagesLoaded: number;
  /** Groups whose posts were read, on either site. */
  groupsRead: number;
  /** Groups read for the first time: what they hold is the starting line,
   *  and nothing in them is announced. */
  baselines: number;
  /** Groups read through m.facebook.com because www.facebook.com drew no
   *  posts. */
  fallbacks: number;
  /** Groups that could not be read this pass: not a member, not available,
   *  or nothing drawn on either site. */
  unreadable: number;
  postsRead: number;
  scrolls: number;
  /** Items that matched, new or not, inside the age window. */
  matches: number;
  newItems: number;
  /** New items triaged as high urgency. */
  urgent: number;
  /** Posts opened to read their comments, and posts whose comments grew but
   *  wait for the next pass because this one had opened its share. */
  commentReads: number;
  commentReadsDeferred: number;
  stopped: boolean;
  /** Something unexpected ended the pass early — not Facebook's screens, but
   *  an error in the browser or the engine. The notes say what. */
  failed: boolean;
  notes: string[];
}

export interface PassResult {
  state: MonitorState;
  events: MonitorEvent[];
  summary: PassSummary;
  /** Every item the pass found that matched, new or not, inside the age
   *  window, most urgent first: what a dashboard shows. */
  matches: Match[];
}

export interface AccountCheck {
  signedIn: boolean;
  name?: string;
  id?: string;
  /** Facebook wants a security check before anything else. */
  securityCheck?: boolean;
  /** Why facebook.com could not be read at all. */
  blocked?: string;
}

class StopRequested extends Error {}
class SignedOut extends Error {}
class SecurityCheck extends Error {}
class RateLimited extends Error {}

const SECURITY_NOTE = "Facebook stopped this account at a security check. Open facebook.com in the profile and complete it; monitoring picks up on the next pass.";
const SIGNED_OUT_NOTE = "The profile is not signed in to Facebook. Group posts can only be read signed in: sign it in, and monitoring picks up on the next pass.";
const NO_GROUPS_NOTE = "No groups to watch: add up to 10 group links.";
const NO_FILTER_NOTE = "No keywords and reportAllPosts is off: only posts and comments that mention you, and comments on your own posts, are reported. Add keywords or turn on reportAllPosts.";

function blockedNote(text: string): string {
  return `Facebook is blocking this account from reading ("${text}"). The pass stopped; the next one waits three intervals.`;
}

/** checkAccount opens facebook.com and reads who is signed in, and stops
 *  there: no group is read, and the page is left open for a person who is
 *  about to sign in. It is what a panel calls before any monitoring has run. */
export async function checkAccount(deps: { browser: MonitorBrowser; now?: () => number; sleep?: Sleep; log?: LogSink }): Promise<AccountCheck> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const log = makeLogger(deps.log, now);
  await deps.browser.open(SIGN_IN_URL);
  await deps.browser.waitForLoad(20).catch(() => undefined);
  await waitForElement(deps.browser, HOME_READY_SELECTOR, 15_000, sleep, now);
  const me = await deps.browser.evaluate<IdentitySnapshot>(identityScript(), "identity");
  log("identity", { url: me.url, gate: me.gate, id: me.id, name: me.name, chrome: me.chrome });
  if (me.gate.checkpoint) return { signedIn: false, securityCheck: true };
  if (me.gate.login_wall || (!me.id && !me.chrome)) return { signedIn: false };
  const who = { ...(me.name ? { name: me.name } : {}), ...(me.id ? { id: me.id } : {}) };
  if (me.gate.blocked) return { signedIn: true, ...who, blocked: blockedNote(me.gate.blocked) };
  return { signedIn: true, ...who };
}

/** runPass runs one monitoring pass. It does not throw for anything Facebook
 *  or the browser does; failures end up in the summary's notes and the log. */
export async function runPass(deps: PassDeps): Promise<PassResult> {
  return new Pass(deps).run();
}

/** A post whose comments are worth reading this pass. */
interface ThreadPlan {
  post: GroupPost;
  count: number;
  own: boolean;
  /** The post itself is new this pass: every comment under it is too. */
  fresh: boolean;
}

class Pass {
  private readonly browser: MonitorBrowser;
  private readonly now: () => number;
  private readonly sleep: Sleep;
  private readonly random: () => number;
  private readonly log: Logger;
  private readonly deps: PassDeps;
  private readonly at: number;
  private state: MonitorState;
  private readonly events: MonitorEvent[] = [];
  private readonly matches = new Map<string, Match>();
  /** What was seen before this pass: the feed position rule needs the line
   *  as it was, not as this pass moves it. */
  private readonly seenBefore: ReadonlySet<string>;
  /** Every key seen, oldest first. A key seen again moves to the newest end,
   *  so what stays in view — a pinned post, a long-lived thread — is never
   *  the first to be cut when the list is trimmed, and never announced
   *  twice. */
  private readonly seen: Set<string>;
  private readonly sources: Record<string, SourceState> = {};
  private readonly posts: Record<string, PostWatch>;
  private readonly planned = new Set<string>();
  private readonly keywords: Matcher;
  private readonly excluded: Matcher;
  private readonly urgent: Matcher;
  private account: Account = {};
  private accountRead = false;
  private opened = false;
  private readonly summary: PassSummary = {
    signedIn: false,
    loginRequired: false,
    securityCheck: false,
    rateLimited: false,
    pagesLoaded: 0,
    groupsRead: 0,
    baselines: 0,
    fallbacks: 0,
    unreadable: 0,
    postsRead: 0,
    scrolls: 0,
    matches: 0,
    newItems: 0,
    urgent: 0,
    commentReads: 0,
    commentReadsDeferred: 0,
    stopped: false,
    failed: false,
    notes: [],
  };

  constructor(deps: PassDeps) {
    this.deps = deps;
    this.browser = deps.browser;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? defaultSleep;
    this.random = deps.random ?? Math.random;
    this.log = makeLogger(deps.log, this.now);
    this.at = this.now();
    this.state = normalizeState(deps.state);
    this.seenBefore = new Set(this.state.seen);
    this.seen = new Set(this.state.seen);
    this.posts = { ...this.state.posts };
    const settings = this.state.settings;
    this.keywords = keywordMatcher(settings.keywords);
    this.excluded = keywordMatcher(settings.excludeKeywords);
    this.urgent = keywordMatcher(settings.urgentTerms);
  }

  async run(): Promise<PassResult> {
    this.log("pass_start", { settings: this.state.settings, account: this.state.account?.name });
    const settings = this.state.settings;
    try {
      if (settings.groups.length === 0) {
        this.note(NO_GROUPS_NOTE);
      } else {
        if (settings.keywords.length === 0 && !settings.reportAllPosts) this.note(NO_FILTER_NOTE);
        for (const group of settings.groups) await this.readGroup(group);
      }
    } catch (error) {
      if (error instanceof StopRequested) {
        this.summary.stopped = true;
      } else if (error instanceof SignedOut) {
        this.signOut();
      } else if (error instanceof SecurityCheck) {
        this.securityCheck();
      } else if (error instanceof RateLimited) {
        this.summary.rateLimited = true;
        this.summary.blocked = error.message;
        this.note(error.message);
      } else {
        this.summary.failed = true;
        this.note(`The pass failed: ${errorText(error)}`);
        this.log("pass_error", { error: errorText(error) });
      }
    } finally {
      await this.park();
    }
    this.finish();
    const matches = [...this.matches.values()].sort(byUrgency);
    this.summary.matches = matches.length;
    this.log("pass_end", { ...this.summary });
    return { state: this.state, events: this.events, summary: this.summary, matches };
  }

  // --- account ---------------------------------------------------------------

  /** readAccount reads who is signed in, once per pass, on the first page
   *  that is past the sign-in wall. The id comes from the session cookie and
   *  is what tells the account's own posts and its tags; the name is what
   *  tells a mention written as plain text. */
  private async readAccount(): Promise<void> {
    if (this.accountRead) return;
    this.accountRead = true;
    const me = await this.browser.evaluate<IdentitySnapshot>(identityScript(), "identity");
    this.log("identity", { url: me.url, gate: me.gate, id: me.id, name: me.name, chrome: me.chrome });
    this.checkGate(me.gate);
    // No session cookie and no account button: Facebook drew a public group
    // to a visitor and left out the login dialog that usually says so.
    // checkAccount reads it the same way.
    if (!me.id && !me.chrome) throw new SignedOut();
    const previous = this.state.account;
    const id = me.id || previous?.id;
    const name = me.name || (me.id && me.id !== previous?.id ? undefined : previous?.name);
    if (!id && !name) this.note("Signed in, but Facebook did not say as whom: mentions of the account and its own posts are not recognized this pass.");
    if (!previous?.signedIn) this.emit({ type: "signed_in", at: this.at, ...(name ? { name } : {}), ...(id ? { id } : {}) });
    if (previous?.id && me.id && previous.id !== me.id) {
      this.emit({ type: "account_changed", at: this.at, previous: previous.name || previous.id, current: name || me.id });
      // Another account's own posts are not this one's.
      for (const [postId, watch] of Object.entries(this.posts)) {
        if (watch.own) delete this.posts[postId];
      }
    }
    this.account = { ...(id ? { id } : {}), ...(name ? { name } : {}) };
    this.state = { ...this.state, account: { ...this.account, signedIn: true, checkedAt: this.at } };
    this.summary.signedIn = true;
    if (name) this.summary.account = name;
  }

  private signOut(): void {
    const previous = this.state.account;
    if (previous?.signedIn !== false) this.emit({ type: "signed_out", at: this.at, ...(previous?.name ? { name: previous.name } : {}) });
    this.state = {
      ...this.state,
      account: { ...(previous?.id ? { id: previous.id } : {}), ...(previous?.name ? { name: previous.name } : {}), signedIn: false, checkedAt: this.at },
    };
    this.summary.signedIn = false;
    this.summary.loginRequired = true;
    this.note(SIGNED_OUT_NOTE);
  }

  private securityCheck(): void {
    const name = this.account.name || this.state.account?.name;
    this.emit({ type: "security_check", at: this.at, ...(name ? { name } : {}) });
    this.summary.securityCheck = true;
    this.summary.blocked = SECURITY_NOTE;
    this.note(SECURITY_NOTE);
  }

  // --- groups ----------------------------------------------------------------

  /** readGroup reads one watched group: its newest posts, chronologically,
   *  down to where the last pass stopped; then the comments under the posts
   *  that concern the account and whose comment count grew. */
  private async readGroup(id: string): Promise<void> {
    const key = groupKey(id);
    this.planned.add(key);
    const known = this.state.sources[key]?.name;
    this.step(`Reading ${known ?? `group ${id}`}`);

    let page = await this.load(feedUrl(id), FEED_READY_SELECTOR);
    await this.readAccount();
    let name = known;
    let posts: GroupPost[] = [];
    let readAt = this.now();
    let fallback = false;
    if (page.gate.not_member) {
      this.groupFailed(key, id, `You are not a member of ${known ?? `group ${id}`}: join it from this account, or remove it from the list.`);
      return;
    }
    if (page.rendered && !page.gate.unavailable) {
      const read = await this.collect(key, groupContext(id, known));
      posts = read.posts;
      readAt = read.readAt;
      name = read.name || name;
    }
    if (posts.length === 0) {
      // www.facebook.com drew no posts: a blank page, its error screen, or
      // "This content isn't available right now". The server-drawn mobile
      // site is a different front end, and often draws what the other one
      // could not; it is tried once.
      const wwwUnavailable = page.gate.unavailable;
      page = await this.load(mobileFeedUrl(id), MOBILE_READY_SELECTOR);
      if (page.gate.not_member) {
        this.groupFailed(key, id, `You are not a member of ${name ?? `group ${id}`}: join it from this account, or remove it from the list.`);
        return;
      }
      let snapshot: FeedSnapshot;
      const redirected = page.host === "www";
      if (redirected) {
        // m.facebook.com sends a desktop browser back to www.facebook.com
        // (?_rdr): the mobile reader finds nothing there, the www one may.
        const again = await this.collect(key, groupContext(id, name));
        snapshot = { url: page.url, gate: page.gate, feed: true, group_name: again.name, posts: [] };
        readAt = again.readAt;
        name = name || again.name || undefined;
        posts = again.posts;
      } else {
        snapshot = await this.browser.evaluate<FeedSnapshot>(mobileGroupScript(), "mobile-feed");
        this.checkGate(snapshot.gate);
        readAt = this.now();
        name = name || snapshot.group_name || undefined;
        posts = normalizePosts(snapshot.posts ?? [], groupContext(id, name), readAt);
      }
      if (posts.length === 0) {
        this.log("group_unreadable", { group: id, www_unavailable: wwwUnavailable, mobile: page, diag: snapshot.diag });
        const label = name ?? `group ${id}`;
        this.groupFailed(key, id, wwwUnavailable || page.gate.unavailable
          ? `${label} is not available to this account: the link may be wrong, or the group was removed. It is skipped this pass.`
          : `${label} could not be read this pass: Facebook drew no posts on www.facebook.com or m.facebook.com.`);
        return;
      }
      if (!redirected) {
        fallback = true;
        this.summary.fallbacks += 1;
        this.note(`${name ?? `Group ${id}`} was read through m.facebook.com: www.facebook.com drew no posts.`);
      }
    }
    this.summary.groupsRead += 1;
    await this.consider(key, groupContext(id, name), posts, readAt, fallback);
  }

  /** collect reads a group's feed top down, scrolling until the read is back
   *  in ground the last pass covered, the scroll limit is reached, or the feed
   *  ends. A first read takes what is drawn and does not scroll: it announces
   *  nothing, so there is nothing to look for further down. */
  private async collect(key: string, group: GroupContext): Promise<{ posts: GroupPost[]; name: string; readAt: number }> {
    const baseline = !this.state.sources[key];
    const posts: GroupPost[] = [];
    const ids = new Set<string>();
    let name = "";
    let readAt = this.now();
    let scrolls = 0;
    let stalls = 0;
    for (;;) {
      const snapshot = await this.browser.evaluate<FeedSnapshot>(groupFeedScript(), "feed");
      this.checkGate(snapshot.gate);
      readAt = this.now();
      name = name || snapshot.group_name;
      const before = posts.length;
      for (const post of normalizePosts(snapshot.posts ?? [], name ? { ...group, name } : group, readAt)) {
        if (ids.has(post.id)) continue;
        ids.add(post.id);
        posts.push(post);
      }
      if (posts.length === 0 && snapshot.diag) this.log("feed_empty_read", { url: snapshot.url, diag: snapshot.diag });
      if (posts.length === 0) break;
      // A first read announces nothing, but the panel lists what matched, and
      // a group page draws only a post or two before it is scrolled.
      if (baseline && scrolls >= Math.min(BASELINE_SCROLLS, this.state.settings.maxScrolls)) break;
      if (!baseline && posts.filter((post) => this.seenBeforePass(post)).length >= KNOWN_TO_STOP) break;
      if (scrolls >= this.state.settings.maxScrolls) break;
      this.checkStop();
      const scroll = await this.browser.evaluate<ScrollState>(scrollScript(), "scroll");
      scrolls += 1;
      this.summary.scrolls += 1;
      // Reading takes a person a moment; a feed scrolled through in a blink
      // is what a script looks like.
      await this.sleep(this.pause(1200, 3500));
      if (posts.length === before && scroll.after <= scroll.before) {
        stalls += 1;
        if (stalls >= MAX_STALLS) break;
      } else {
        stalls = 0;
      }
    }
    return { posts, name, readAt };
  }

  /** consider decides what in one group's read is new, ranks what matches,
   *  records the group, and reads the comments that are due.
   *
   *  A post is new when its id was not seen before and either it sits above
   *  the newest post the last pass saw — in a chronological feed, anything
   *  above a known post came after it — or its drawn time says it was created
   *  after the group's starting line. A post whose drawn time says it is older
   *  than the starting line is never new: it is pinned, or bumped back into
   *  view. */
  private async consider(key: string, group: GroupContext, posts: GroupPost[], readAt: number, fallback: boolean): Promise<void> {
    const previous = this.state.sources[key];
    const baseline = !previous;
    const since = previous?.since ?? this.at;
    const line = posts.findIndex((post) => this.seenBeforePass(post));
    const source: ItemSource = { kind: "group_post", name: group.name, group: group.id };
    const fresh: Match[] = [];
    const plans: ThreadPlan[] = [];
    this.summary.postsRead += posts.length;

    if (!baseline && posts.length > 0 && line < 0) {
      this.note(`${group.name}: the read did not get back to posts seen before (${posts.length} read); posts in between may be missed.`);
    }

    for (const [index, post] of posts.entries()) {
      const own = isOwn(post, this.account);
      const isNew = !baseline && !this.seenBeforePass(post) && this.freshPost(post.range, index, line, since, readAt);
      const mention = !own && mentionsAccount(post.text, post.mentions, this.account);
      const keywords = this.keywords(post.text);
      const addressed: Addressed | undefined = mention ? "mention" : undefined;
      const watch = this.posts[post.id];
      this.plan(plans, post, { own, isNew, baseline, aboutYou: own || mention || keywords.length > 0 });
      this.remember(post.key);
      // Kept under both ids, so a read that finds only one of them knows the
      // post.
      if (post.altKey) this.remember(post.altKey);
      if (own) continue;
      if (!mention && keywords.length === 0 && !this.state.settings.reportAllPosts) continue;
      if (!addressed && this.excluded(post.text).length > 0) continue;
      const gained = watch && post.comments !== undefined ? Math.max(0, post.comments - watch.comments) : 0;
      const item = postItem(post, addressed);
      const match: Match = { item, source, keywords, triage: triage(item, { keywords, urgent: this.urgent, gained }) };
      if (this.inWindow(post.range) && !this.matches.has(item.key)) this.matches.set(item.key, match);
      if (isNew) fresh.push(match);
    }

    // The feed is newest first; events go out oldest first.
    for (const match of fresh.reverse()) this.announce(match);
    if (baseline) this.summary.baselines += 1;
    this.log("group", { group: group.id, name: group.name, baseline, read: posts.length, line, fresh: fresh.length, fallback });
    this.sources[key] = {
      since,
      ...(group.name !== group.id ? { name: group.name } : previous?.name ? { name: previous.name } : {}),
      lastReadAt: this.at,
      ...(fresh.length > 0 ? { lastNewAt: this.at } : previous?.lastNewAt !== undefined ? { lastNewAt: previous.lastNewAt } : {}),
      ...(fallback ? { fallback: true } : {}),
    };

    await this.readThreads(key, group, plans, since);
  }

  /** seenBeforePass says whether the last passes saw a post, under either of
   *  its ids. */
  private seenBeforePass(post: GroupPost): boolean {
    return this.seenBefore.has(post.key) || (!!post.altKey && this.seenBefore.has(post.altKey));
  }

  private freshPost(range: TimeRange | undefined, index: number, line: number, since: number, readAt: number): boolean {
    if (range && range.latest < since) return false;
    const maxAge = this.state.settings.maxItemAgeMs;
    if (range && maxAge > 0 && range.latest < readAt - maxAge) return false;
    if (line >= 0 && index < line) return true;
    return !!range && range.earliest >= since;
  }

  private inWindow(range: TimeRange | undefined): boolean {
    const maxAge = this.state.settings.maxItemAgeMs;
    return maxAge === 0 || !range || range.latest >= this.at - maxAge;
  }

  /** plan decides whether a post's comments are due. Only posts that concern
   *  the account are watched: its own posts, and posts that mention it or
   *  name a keyword. A post seen for the first time is only recorded — its
   *  comments are part of the starting line — unless the post itself is new:
   *  then its comments are all new too. After that, a post is opened only when
   *  its drawn comment count grew.
   *
   *  A new post is recorded with a count of nothing at once, before its page
   *  is read: a pass that stops, is blocked, or cannot open the page before
   *  then would otherwise leave no record, and the next pass, seeing the post
   *  as already seen, would take its comments as part of the starting line. */
  private plan(plans: ThreadPlan[], post: GroupPost, about: { own: boolean; isNew: boolean; baseline: boolean; aboutYou: boolean }): void {
    if (!this.state.settings.watchComments || !about.aboutYou || post.comments === undefined) return;
    const watch = this.posts[post.id];
    const count = post.comments;
    const grew = watch ? count > watch.comments : !about.baseline && about.isNew && count > 0;
    if (!grew) {
      this.posts[post.id] = {
        group: post.group.id,
        own: about.own,
        comments: watch ? Math.min(watch.comments, count) : count,
        ...(watch?.threadReadAt !== undefined ? { threadReadAt: watch.threadReadAt } : {}),
        checkedAt: this.at,
      };
      return;
    }
    plans.push({ post, count, own: about.own, fresh: !watch && about.isNew });
    if (!watch) this.posts[post.id] = { group: post.group.id, own: about.own, comments: 0, checkedAt: this.at };
  }

  /** readThreads opens the posts whose comments are due, up to the pass's
   *  share. A post past that keeps its old count (a new post, the count of
   *  nothing plan gave it), so the next pass sees the growth and opens it:
   *  nothing is skipped, only delayed. */
  private async readThreads(key: string, group: GroupContext, plans: ThreadPlan[], since: number): Promise<void> {
    for (const plan of plans) {
      const watch = this.posts[plan.post.id];
      if (this.summary.commentReads >= this.state.settings.maxCommentReads) {
        this.summary.commentReadsDeferred += 1;
        continue;
      }
      this.step(`Reading comments in ${group.name}`);
      const page = await this.load(plan.post.url, THREAD_READY_SELECTOR, THREAD_WAIT_MS);
      this.summary.commentReads += 1;
      if (page.gate.unavailable || page.gate.not_member) {
        this.log("thread_failed", { post: plan.post.id, gate: page.gate });
        continue;
      }
      const thread = await this.browser.evaluate<ThreadSnapshot>(threadScript(), "thread");
      this.checkGate(thread.gate);
      const readAt = this.now();
      const source: ItemSource = { kind: "group_comment", name: group.name, group: group.id };
      const comments = thread.comments ?? [];
      // Only comments that can be reported count: one drawn without an author
      // or text is never recorded, and would look unseen on every read.
      const unseen = comments.filter((raw) => String(raw.text ?? "").trim() && raw.author && !this.seen.has(commentKey(raw, plan.post.id))).length;
      const before = watch?.comments ?? 0;
      const allNew = plan.fresh || unseen <= plan.count - before;
      for (const raw of comments) {
        const own = isOwn({ author: raw.author, authorId: raw.author_id }, this.account);
        const mention = !own && mentionsAccount(raw.text, raw.mentions ?? [], this.account);
        const addressed: Addressed | undefined = own ? undefined : mention ? "mention" : plan.own ? "comment_on_post" : undefined;
        const item = commentItem(raw, plan.post, readAt, addressed);
        if (!item) continue;
        const range = drawnTimeRange(raw.time_text, readAt);
        const isNew = !this.seen.has(item.key) && this.freshComment(range, readAt, since, allNew);
        this.remember(item.key);
        if (own) continue;
        const keywords = this.keywords(item.text);
        if (!addressed && keywords.length === 0) continue;
        if (!addressed && this.excluded(item.text).length > 0) continue;
        const match: Match = { item, source, keywords, triage: triage(item, { keywords, urgent: this.urgent }) };
        if (this.inWindow(range) && !this.matches.has(item.key)) this.matches.set(item.key, match);
        if (isNew) this.announce(match);
      }
      const counted = Math.max(plan.count, commentCount(thread.comments_text) ?? 0);
      let { comments: read, shortReads } = this.countRead(before, counted, unseen, watch?.shortReads ?? 0);
      if (shortReads >= MAX_SHORT_READS) {
        read = counted;
        shortReads = 0;
        this.note(`${group.name}: a post's comment count grew, but its page drew fewer new comments ${MAX_SHORT_READS} times running; the count is taken as read. Facebook counts replies, which are not read, and its "Most relevant" order may hide comments.`);
      }
      this.posts[plan.post.id] = {
        group: group.id,
        own: plan.own,
        comments: read,
        threadReadAt: this.at,
        ...(shortReads > 0 ? { shortReads } : {}),
        checkedAt: this.at,
      };
      this.log("thread", { group: key, post: plan.post.id, comments: comments.length, unseen, before, counted, recorded: read, short_reads: shortReads });
    }
  }

  /** countRead moves a post's recorded count by what its page actually drew.
   *  The page shows the comments Facebook picks — a slow load or collapsed
   *  comments draw none, and its "Most relevant" order leaves some out — and
   *  the monitor never clicks to show more. So the count moves only by the
   *  unseen comments read; the rest stay due, and the post is opened again.
   *  A read that fell short is counted, so that comments that will never be
   *  drawn do not keep the post open forever. */
  private countRead(before: number, counted: number, unseen: number, shortReads: number): { comments: number; shortReads: number } {
    if (before + unseen >= counted) return { comments: counted, shortReads: 0 };
    return { comments: before + unseen, shortReads: shortReads + 1 };
  }

  /** freshComment decides whether an unseen comment is new. With a drawn
   *  time it is new when it was written after the group's starting line (and
   *  inside the age window). Without one, it is new only when every unseen
   *  comment must be: under a post that is itself new, or when no more
   *  comments are unseen than the count grew by. The first opening of an
   *  older post shows comments it had before the starting line too, and
   *  those, undated, cannot be told from the new ones. */
  private freshComment(range: TimeRange | undefined, readAt: number, since: number, allNew: boolean): boolean {
    if (range) {
      const maxAge = this.state.settings.maxItemAgeMs;
      return range.latest >= since && (maxAge === 0 || range.latest >= readAt - maxAge);
    }
    return allNew;
  }

  private announce(match: Match): void {
    this.emit({ type: "new_item", at: this.at, ...(this.account.name ? { account: this.account.name } : {}), ...match });
    this.summary.newItems += 1;
    if (match.triage.urgency === "high") this.summary.urgent += 1;
  }

  private groupFailed(key: string, id: string, note: string): void {
    this.summary.unreadable += 1;
    this.note(note);
    this.log("group_failed", { group: id, note });
    const previous = this.state.sources[key];
    if (previous) this.sources[key] = { ...previous, note };
  }

  private remember(key: string): void {
    // A Set keeps the order keys were added in: taking a key out and putting
    // it back moves it to the newest end.
    this.seen.delete(key);
    this.seen.add(key);
  }

  // --- plumbing --------------------------------------------------------------

  /** load opens one page, paced like a person moving between pages, and turns
   *  the screens that end a pass — the sign-in wall, a security check, a
   *  block — into the matching error. */
  private async load(url: string, readySelector: string, readyMs?: number): Promise<PageHealth> {
    this.checkStop();
    if (this.summary.pagesLoaded > 0) await this.sleep(this.pause(4000, 9000));
    this.checkStop();
    this.opened = true;
    const page = await loadPage(this.browser, url, readySelector, {
      sleep: this.sleep,
      log: this.log,
      now: this.now,
      ...(readyMs !== undefined ? { readyMs } : {}),
    });
    this.summary.pagesLoaded += 1;
    this.checkGate(page.gate);
    return page;
  }

  private checkGate(gate: Gate | undefined): void {
    if (!gate) return;
    if (gate.checkpoint) throw new SecurityCheck();
    if (gate.login_wall) throw new SignedOut();
    if (gate.blocked) throw new RateLimited(blockedNote(gate.blocked));
  }

  /** finish settles the sources, the watched posts and the seen list. A group
   *  that is no longer configured is forgotten, so adding it back starts a
   *  fresh starting line. */
  private finish(): void {
    const deferred = this.summary.commentReadsDeferred;
    if (deferred > 0) this.note(`${deferred} post${deferred === 1 ? "" : "s"} with new comments wait${deferred === 1 ? "s" : ""} for the next pass (maxCommentReads).`);
    const configured = new Set(this.state.settings.groups.map((group) => groupKey(group)));
    const sources: Record<string, SourceState> = {};
    for (const [key, value] of Object.entries(this.state.sources)) {
      if (configured.has(key)) sources[key] = value;
    }
    Object.assign(sources, this.sources);
    const posts = Object.fromEntries(
      Object.entries(this.posts)
        .filter(([, watch]) => configured.has(groupKey(watch.group)))
        .sort(([, left], [, right]) => left.checkedAt - right.checkedAt)
        .slice(-MAX_POSTS_WATCHED),
    );
    this.state = {
      ...this.state,
      sources,
      posts,
      seen: [...this.seen].slice(-MAX_SEEN),
      lastPass: {
        at: this.at,
        finishedAt: this.now(),
        newItems: this.summary.newItems,
        urgent: this.summary.urgent,
        notes: this.summary.notes,
      },
    };
  }

  /** park leaves the tab on a blank page, so nothing is left polling
   *  facebook.com between passes. It is best effort. */
  private async park(): Promise<void> {
    if (!this.state.settings.parkTab || !this.opened) return;
    try {
      await this.browser.open(BLANK_PAGE);
    } catch (error) {
      this.log("park_failed", { error: errorText(error) });
    }
  }

  private pause(min: number, max: number): number {
    return Math.round(min + (max - min) * this.random());
  }

  private emit(event: MonitorEvent): void {
    this.events.push(event);
    this.log("event", { event });
    try {
      this.deps.onEvent?.(event);
    } catch (error) {
      this.log("on_event_failed", { error: errorText(error) });
    }
  }

  private step(step: string): void {
    this.log("step", { step });
    try {
      this.deps.onStep?.(step);
    } catch {
      /* a status line is not worth a pass */
    }
  }

  private note(note: string): void {
    if (this.summary.notes.includes(note)) return;
    this.summary.notes = [...this.summary.notes, note].slice(-MAX_PASS_NOTES);
  }

  private checkStop(): void {
    if (this.deps.shouldStop?.()) throw new StopRequested("stopped");
  }
}
