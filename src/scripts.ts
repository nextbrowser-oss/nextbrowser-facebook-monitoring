// Page scripts: every read the monitor makes on facebook.com.
//
// Facebook draws a group from data its own app fetches with per-session
// tokens, and that data is not something a script outside the app can ask for
// and keep up with. What a signed-in member sees, though, is drawn into the
// page. So the monitor reads the page: it opens the group, waits until the
// feed is drawn, and reads the posts out of the DOM.
//
// Facebook's markup is generated: class names are random strings that change
// with every release, and nothing carries a test id. What survives releases is
// what assistive technology and links need, so that is all these scripts lean
// on:
//
//   - roles: the group feed is [role="feed"], each post in it a
//     [role="article"] or an [aria-posinset] unit, and each comment a
//     [role="article"] labelled "Comment by …";
//   - attributes Facebook sets for its own reasons: data-ad-preview="message"
//     on a post's text, dir="auto" on user-written text;
//   - link shapes: a post's permalink (/groups/<g>/posts/<id>/), an author's
//     profile (/groups/<g>/user/<id>/, /profile.php?id=<id>), a comment's
//     ?comment_id=<id>.
//
// Words are leaned on only where nothing else exists: the sign-in, security
// check and "temporarily blocked" screens, the not-a-member notice, and the
// "Comment by" label. They are matched in English; an account whose Facebook
// is set to another language reads the posts all the same, but those states
// are reported less precisely.
//
// Each script is one expression returning a JSON-serializable value, run
// through CDP Runtime.evaluate with returnByValue. Nothing here clicks, types
// or submits: a post cut short by "See more" is reported as cut short rather
// than expanded.

/** jsLiteral renders a value as a JavaScript literal safe to inline. */
export function jsLiteral(value: unknown): string {
  return JSON.stringify(value ?? "");
}

/** Where a person signs in, and where checkAccount looks. */
export const SIGN_IN_URL = "https://www.facebook.com/";

/** What a group page draws once Facebook has answered: a post in the feed. */
export const FEED_READY_SELECTOR = `[role="feed"] [role="article"], [role="feed"] [aria-posinset]`;
/** What m.facebook.com's server-drawn group page holds: articles, and links
 *  to full stories. */
export const MOBILE_READY_SELECTOR = `article, [data-ft*="top_level_post_id"], a[href*="/story.php"], a[href*="/permalink/"]`;
/** What a post's own page draws once its comments are in. */
export const THREAD_READY_SELECTOR = `[role="article"][aria-label^="Comment by"]`;
/** What the home page draws for a signed-in account. */
export const HOME_READY_SELECTOR = `[aria-label="Your profile"], [role="banner"], [role="feed"]`;

/** How much of a post or a comment is kept. */
export const TEXT_MAX = 2_000;

/** gate() names every screen Facebook puts between a session and a group:
 *
 *  - the sign-in wall: /login, a login form, or the email and password
 *    fields of the dialog a signed-out visitor gets over a public group;
 *  - a security check: anything under /checkpoint/;
 *  - a block: "You're Temporarily Blocked", "You can't use this feature right
 *    now", "Your account is restricted", and the "going too fast" warning;
 *  - an unavailable group: "This content isn't available right now", which is
 *    also what a wrong link or a removed group shows;
 *  - not a member: a private group draws its About card and a Join button, and
 *    no feed. The card's "Only members can see…" line is drawn for members
 *    too, so it only counts on a page with no posts. */
const GATE_HELPER = String.raw`
  const has = (selector) => { try { return !!document.querySelector(selector); } catch (error) { return false; } };
  const pageText = () => String((document.body && document.body.innerText) || "").replace(/\s+/g, " ");
  const gate = () => {
    const path = String(location.pathname || "").toLowerCase();
    const text = pageText();
    const checkpoint = path.indexOf("/checkpoint") >= 0;
    const loginForm = has('form[action*="login"]') || (has('input[name="email"]') && has('input[name="pass"]'));
    const content = has('[role="feed"], [role="article"], article, [data-ft]');
    const blocked = /you[’']re temporarily blocked|you can[’']t use this feature right now|your account (?:is|has been) restricted|misusing this feature by going too fast/i.exec(text);
    const unavailable = !content && /this content isn[’']t available|this page isn[’']t available|the link you followed may be broken|content not found/i.test(text);
    const notMember = !content && !unavailable && /only members can see|you[’']re not a member of this group|you are not a member of this group|join (?:this )?group to see/i.test(text);
    return {
      login_wall: !checkpoint && (path.indexOf("/login") === 0 || loginForm),
      checkpoint: checkpoint,
      blocked: blocked ? blocked[0].slice(0, 120) : "",
      unavailable: unavailable,
      not_member: notMember
    };
  };
  const gated = (state) => state.login_wall || state.checkpoint || !!state.blocked || state.unavailable || state.not_member;`;

/** pageDiag() describes the page for the log. Every field is read
 *  defensively: a diagnostic must never be what breaks the read it describes. */
const DIAG_HELPER = String.raw`
  const pageDiag = () => {
    const count = (selector) => { try { return document.querySelectorAll(selector).length; } catch (error) { return 0; } };
    const view = typeof window === "object" && window ? window : {};
    return {
      width: Number(view.innerWidth) || 0,
      height: Number(view.innerHeight) || 0,
      ready: String(document.readyState || ""),
      title: String(document.title || "").slice(0, 80),
      feeds: count('[role="feed"]'),
      articles: count('[role="article"], article'),
      text: pageText().trim().slice(0, 160)
    };
  };`;

/** Links: which ones are a post's permalink, which an author's profile, and
 *  how a post's text is read the way a person sees it. */
const LINK_HELPER = String.raw`
  const POST_ID = /^(?:\d{1,25}|pfbid[A-Za-z0-9]{10,80})$/;
  const RESERVED = /^(groups|events|pages|watch|marketplace|gaming|hashtag|photo|photos|login|help|policies|settings|notifications|messages|friends|bookmarks|saved|reel|reels|stories|share|sharer|privacy|ads|business)$/i;
  const absolute = (href) => { try { return new URL(String(href || ""), location.href); } catch (error) { return null; } };
  const onFacebook = (url) => !!url && /(^|\.)facebook\.com$/i.test(url.hostname);
  const permalinkOf = (href) => {
    const url = absolute(href);
    if (!onFacebook(url)) return null;
    let group = "";
    let id = "";
    const path = /\/groups\/([^/?#]+)\/(?:posts|permalink)\/([^/?#]+)/.exec(url.pathname);
    if (path) { group = path[1]; id = path[2]; }
    else {
      const groupPath = /^\/groups\/([^/?#]+)\/?$/.exec(url.pathname);
      const multi = String(url.searchParams.get("multi_permalinks") || "").split(",")[0];
      const story = String(url.searchParams.get("story_fbid") || "");
      if (groupPath && multi) { group = groupPath[1]; id = multi; }
      else if (story && /\/(?:permalink|story)\.php$/.test(url.pathname)) { id = story; group = String(url.searchParams.get("id") || ""); }
    }
    return POST_ID.test(id) ? { group: group, id: id } : null;
  };
  const profileOf = (href) => {
    const url = absolute(href);
    if (!onFacebook(url)) return null;
    const member = /\/groups\/[^/]+\/user\/(\d{1,25})/.exec(url.pathname);
    if (member) return { id: member[1], url: "https://www.facebook.com/profile.php?id=" + member[1] };
    if (url.pathname === "/profile.php") {
      const id = String(url.searchParams.get("id") || "");
      return /^\d{1,25}$/.test(id) ? { id: id, url: "https://www.facebook.com/profile.php?id=" + id } : null;
    }
    const vanity = /^\/([A-Za-z0-9.]{3,50})\/?$/.exec(url.pathname);
    if (vanity && !RESERVED.test(vanity[1]) && !/\.php$/i.test(vanity[1])) return { id: "", url: "https://www.facebook.com/" + vanity[1] };
    return null;
  };
  const labelOf = (node) => String((node && (node.getAttribute("aria-label") || node.innerText || node.textContent)) || "").replace(/\s+/g, " ").trim();
  // textOf reads user-written text the way a reader sees it: the words, the
  // line breaks, and the emoji Facebook draws as images, which innerText
  // leaves out. The "See more" control inside a cut-short post is skipped.
  const textOf = (root) => {
    let out = "";
    const walk = (node) => {
      if (node.nodeType === 3) {
        // Whitespace that only lays out the markup is not the author's.
        if (!/\S/.test(node.data) && /\n/.test(node.data)) { if (out && !/\s$/.test(out)) out += " "; return; }
        out += node.data;
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (tag === "IMG") { out += node.getAttribute("alt") || ""; return; }
      if (tag === "BR") { out += "\n"; return; }
      if (node.getAttribute("role") === "button" && /^see more$/i.test(labelOf(node))) return;
      let block = tag === "DIV" || tag === "P";
      try { const display = getComputedStyle(node).display; if (display) block = display === "block"; } catch (error) {}
      if (block && out && !/\n[ \t]*$/.test(out)) out += "\n";
      for (const child of node.childNodes) walk(child);
      if (block && !/\n[ \t]*$/.test(out)) out += "\n";
    };
    walk(root);
    return out.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/\s*…\s*$/, "").trim().slice(0, ${TEXT_MAX});
  };
  const mentionsIn = (root, author) => {
    const out = [];
    if (!root) return out;
    for (const link of Array.from(root.querySelectorAll("a[href]"))) {
      const profile = profileOf(link.getAttribute("href"));
      const name = labelOf(link).slice(0, 80);
      if (!profile || !name || (author && profile.url === author)) continue;
      if (!out.some((known) => known.url === profile.url)) out.push({ name: name, id: profile.id, url: profile.url });
    }
    return out.slice(0, 10);
  };
  const COMMENTS_LABEL = /^\d[\d\s.,'KkMm]*\s*(?:comments?|комментари[йяев]*)$/i;
  const SHARES_LABEL = /^\d[\d\s.,'KkMm]*\s*shares?$/i;
  const AND_OTHERS = /\band \d[\d\s.,'KkMm]*\s*others?$/i;`;

/** What any read reports about the screens between the session and the
 *  group. */
export interface Gate {
  login_wall: boolean;
  checkpoint: boolean;
  /** The block notice as Facebook worded it, when there is one. */
  blocked: string;
  /** The group (or post) is not there for this account. */
  unavailable: boolean;
  /** A private group the account has not joined. */
  not_member: boolean;
}

/** What pageDiag() reports. */
export interface PageDiag {
  width: number;
  height: number;
  ready: string;
  title: string;
  feeds: number;
  articles: number;
  text: string;
}

/** What a page did after load. */
export interface PageHealth {
  url: string;
  host: "www" | "m" | "other";
  /** Facebook drew posts, or a feed to hold them. */
  rendered: boolean;
  feed: boolean;
  articles: number;
  gate: Gate;
  diag?: PageDiag;
}

/** pageHealthScript says what the page shows: the group, or one of the
 *  screens in front of it. */
export function pageHealthScript(): string {
  return String.raw`(() => {${GATE_HELPER}${DIAG_HELPER}
  const host = String(location.hostname || "").toLowerCase();
  const count = (selector) => { try { return document.querySelectorAll(selector).length; } catch (error) { return 0; } };
  const feed = has('[role="feed"]');
  const articles = count(${jsLiteral(FEED_READY_SELECTOR)}) || count(${jsLiteral(MOBILE_READY_SELECTOR)});
  const state = gate();
  const out = {
    url: location.href,
    host: host === "www.facebook.com" || host === "facebook.com" ? "www" : host === "m.facebook.com" || host === "mbasic.facebook.com" ? "m" : "other",
    rendered: feed || articles > 0,
    feed: feed,
    articles: articles,
    gate: state
  };
  if (!out.rendered || gated(state)) out.diag = pageDiag();
  return out;
})()`;
}

/** existsScript asks whether anything in the document matches a selector, or
 *  whether the page is one of the screens in front of the group, which ends a
 *  wait just as well: there is nothing more to draw there. */
export function existsScript(selector: string): string {
  return String.raw`(() => {${GATE_HELPER}
  try { return { found: gated(gate()) || !!document.querySelector(${jsLiteral(selector)}) }; } catch (error) { return { found: false }; }
})()`;
}

/** Who is signed in. */
export interface IdentitySnapshot {
  url: string;
  gate: Gate;
  /** The account's numeric id, from the c_user cookie Facebook sets for a
   *  signed-in session. */
  id: string;
  /** The account's name, when the page draws it beside a link to the
   *  account's own profile. */
  name: string;
  /** Whether the signed-in chrome (the "Your profile" button) is drawn. */
  chrome: boolean;
}

/** identityScript reads who is signed in: the id from the session cookie, the
 *  name from a link to that id's profile, or from the account button. Posts
 *  by other people carry names and avatars too, so only links that point at
 *  the account's own id are trusted. */
export function identityScript(): string {
  return String.raw`(() => {${GATE_HELPER}
  const id = (/(?:^|;\s*)c_user=(\d{1,25})/.exec(String(document.cookie || "")) || [])[1] || "";
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const usable = (value) => value.length >= 2 && value.length <= 80 && !/^(your profile|profile|account|see your profile)$/i.test(value);
  let name = "";
  if (id) {
    const links = Array.from(document.querySelectorAll('a[href*="profile.php?id=' + id + '"], a[href*="/user/' + id + '/"]'));
    for (const link of links) {
      const label = clean(link.getAttribute("aria-label") || link.innerText || link.textContent);
      if (usable(label)) { name = label; break; }
    }
  }
  const button = document.querySelector('[aria-label="Your profile"]');
  if (!name && button) {
    const labelled = button.querySelector("svg[aria-label], image[aria-label], img[alt]");
    const label = clean(labelled ? (labelled.getAttribute("aria-label") || labelled.getAttribute("alt")) : "");
    if (usable(label)) name = label;
  }
  return { url: location.href, gate: gate(), id: id, name: name, chrome: !!button };
})()`;
}

/** A post as the page drew it. */
export interface RawPost {
  id: string;
  /** The permalink as drawn, absolute. */
  url: string;
  /** The group named in the permalink: its id or vanity name, or "". */
  group: string;
  author: string;
  /** The author's numeric id, from a /groups/<g>/user/<id>/ or
   *  /profile.php?id=<id> link, or "". */
  author_id: string;
  author_url: string;
  text: string;
  /** Facebook cut the text short behind "See more". */
  truncated: boolean;
  /** The drawn time label: "3h", "Yesterday at 10:15", or a date. */
  time_text: string;
  /** People tagged in the text. */
  mentions: RawMention[];
  /** "23 comments", or "" when none is drawn. */
  comments_text: string;
  /** The reaction label: "1.2K", "You and 12 others", or "". */
  reactions_text: string;
  shares_text: string;
  /** Whether the post's action bar (Like · Comment · Share) is drawn. With it
   *  drawn and no comment count beside it, the post has no comments. */
  action_bar: boolean;
}

export interface RawMention {
  name: string;
  id: string;
  url: string;
}

export interface FeedSnapshot {
  url: string;
  gate: Gate;
  feed: boolean;
  group_name: string;
  posts: RawPost[];
  diag?: PageDiag;
}

/** GROUP_NAME_HELPER reads the group's name from its header, or from the
 *  page title ("(3) Acme Users | Facebook"). */
const GROUP_NAME_HELPER = String.raw`
  const groupName = () => {
    const header = document.querySelector('[role="main"] h1 a[href*="/groups/"], h1 a[href*="/groups/"], [role="main"] h1, h1');
    const fromHeader = header ? String(header.innerText || header.textContent || "").replace(/\s+/g, " ").trim() : "";
    if (fromHeader) return fromHeader.slice(0, 120);
    return String(document.title || "").replace(/^\(\d+\+?\)\s*/, "").replace(/\s*[|·-]\s*Facebook\s*$/i, "").trim().slice(0, 120);
  };`;

/** groupFeedScript reads the posts a www.facebook.com group page has drawn,
 *  top to bottom, which with the chronological sorting is newest first.
 *
 *  A feed unit holds the post and, under it, a preview of its comments, each
 *  a [role="article"] of its own: everything read for the post is read
 *  outside those, so a commenter is never taken for the author. */
export function groupFeedScript(): string {
  return String.raw`(() => {${GATE_HELPER}${DIAG_HELPER}${LINK_HELPER}${GROUP_NAME_HELPER}
  const out = { url: location.href, gate: gate(), feed: has('[role="feed"]'), group_name: groupName(), posts: [] };
  const isComment = (node) => /^(comment|reply) by /i.test(node.getAttribute("aria-label") || "");
  const all = Array.from(document.querySelectorAll(${jsLiteral(FEED_READY_SELECTOR)})).filter((node) => !isComment(node));
  const units = all.filter((node) => !all.some((other) => other !== node && other.contains(node)));
  // The post itself is the unit, or the first article inside it that is not
  // a comment; anything inside a further article below it is a comment.
  const rootOf = (unit) => unit.getAttribute("role") === "article" ? unit
    : Array.from(unit.querySelectorAll('[role="article"]')).find((node) => !isComment(node)) || unit;
  const own = (root, selector) => Array.from(root.querySelectorAll(selector)).filter((node) => {
    for (let current = node.parentElement; current && current !== root; current = current.parentElement) {
      if (current.getAttribute("role") === "article") return false;
    }
    return node.getAttribute("role") !== "article";
  });
  const seen = new Set();
  for (const unit of units) {
    const root = rootOf(unit);
    let permalink = null;
    let timeText = "";
    for (const link of own(root, "a[href]")) {
      const found = permalinkOf(link.getAttribute("href"));
      if (!found) continue;
      if (!permalink) permalink = { found: found, href: absolute(link.getAttribute("href")).href };
      if (found.id !== permalink.found.id) continue;
      const label = labelOf(link);
      if (!timeText && label && label.length <= 40) timeText = label;
    }
    if (!permalink || seen.has(permalink.found.id)) continue;
    seen.add(permalink.found.id);
    let author = null;
    for (const link of own(root, "h2 a[href], h3 a[href], h4 a[href], strong a[href], a[href*='/user/']")) {
      const profile = profileOf(link.getAttribute("href"));
      const name = labelOf(link);
      if (profile && name && name.length <= 80) { author = { name: name, id: profile.id, url: profile.url }; break; }
    }
    const message = own(root, '[data-ad-preview="message"], [data-ad-comet-preview="message"]')[0] || null;
    let text = message ? textOf(message) : "";
    if (!text) {
      // No marked message: the longest piece of user-written text in the
      // post, which is not the author's name.
      for (const node of own(root, 'div[dir="auto"]')) {
        if (node.closest("h2, h3, h4, strong")) continue;
        const value = textOf(node);
        if (value.length > text.length && (!author || value !== author.name)) text = value;
      }
    }
    const labels = own(root, "span, div, a, [role='button']").map((node) => labelOf(node)).filter((label) => label && label.length <= 60);
    const commentsText = labels.find((label) => COMMENTS_LABEL.test(label)) || "";
    const sharesText = labels.find((label) => SHARES_LABEL.test(label)) || "";
    let reactionsText = "";
    for (const node of own(root, "span, div")) {
      const value = String(node.textContent || "").replace(/\s+/g, " ").trim();
      const total = /^All reactions:?\s*(.{1,60})$/i.exec(value);
      if (total) { reactionsText = total[1].trim(); break; }
      if (!reactionsText && AND_OTHERS.test(value) && value.length <= 80) reactionsText = value;
    }
    const actionBar = own(root, '[aria-label="Leave a comment"], [aria-label="Comment"], [role="button"]')
      .some((node) => /^(leave a comment|comment)$/i.test(labelOf(node)));
    const truncated = own(root, '[role="button"]').some((node) => /^see more$/i.test(labelOf(node)));
    out.posts.push({
      id: permalink.found.id,
      url: permalink.href,
      group: permalink.found.group,
      author: author ? author.name : "",
      author_id: author ? author.id : "",
      author_url: author ? author.url : "",
      text: text,
      truncated: truncated,
      time_text: timeText,
      mentions: mentionsIn(message, author ? author.url : ""),
      comments_text: commentsText,
      reactions_text: reactionsText,
      shares_text: sharesText,
      action_bar: actionBar
    });
  }
  if (out.posts.length === 0) out.diag = pageDiag();
  return out;
})()`;
}

/** mobileGroupScript reads a group page on m.facebook.com, the fallback when
 *  www.facebook.com draws no feed. Where Facebook still serves it, the mobile
 *  site is drawn on the server: each post an <article> (or a block with a
 *  data-ft attribute naming the post), its time in an <abbr>, its permalink a
 *  "Full Story" link. */
export function mobileGroupScript(): string {
  return String.raw`(() => {${GATE_HELPER}${DIAG_HELPER}${LINK_HELPER}${GROUP_NAME_HELPER}
  const out = { url: location.href, gate: gate(), feed: false, group_name: groupName(), posts: [] };
  const all = Array.from(document.querySelectorAll('article, [data-ft*="top_level_post_id"]'));
  const units = all.filter((node) => !all.some((other) => other !== node && other.contains(node)));
  out.feed = units.length > 0;
  const seen = new Set();
  for (const unit of units) {
    let found = null;
    let href = "";
    for (const link of Array.from(unit.querySelectorAll("a[href]"))) {
      const candidate = permalinkOf(link.getAttribute("href"));
      if (candidate) { found = candidate; href = absolute(link.getAttribute("href")).href; break; }
    }
    if (!found) {
      let ft = null;
      try { ft = JSON.parse(unit.getAttribute("data-ft") || "null"); } catch (error) { ft = null; }
      const id = ft && ft.top_level_post_id ? String(ft.top_level_post_id) : "";
      if (POST_ID.test(id)) { found = { group: "", id: id }; href = ""; }
    }
    if (!found || seen.has(found.id)) continue;
    seen.add(found.id);
    let author = null;
    for (const link of Array.from(unit.querySelectorAll("header a[href], h3 a[href], h4 a[href], strong a[href]"))) {
      const profile = profileOf(link.getAttribute("href"));
      const name = labelOf(link);
      if (profile && name && name.length <= 80) { author = { name: name, id: profile.id, url: profile.url }; break; }
    }
    const paragraphs = Array.from(unit.querySelectorAll("p"));
    const body = paragraphs.length ? paragraphs.map((node) => textOf(node)).filter(Boolean).join("\n") : "";
    const stamp = unit.querySelector("abbr");
    const labels = Array.from(unit.querySelectorAll("a, span")).map((node) => labelOf(node)).filter((label) => label && label.length <= 60);
    const reaction = unit.querySelector('a[href*="/ufi/reaction/"], [id^="like_"]');
    out.posts.push({
      id: found.id,
      url: href,
      group: found.group,
      author: author ? author.name : "",
      author_id: author ? author.id : "",
      author_url: author ? author.url : "",
      text: body.slice(0, ${TEXT_MAX}),
      truncated: labels.some((label) => /^(see more|more)$/i.test(label)),
      time_text: stamp ? labelOf(stamp) : "",
      mentions: paragraphs.length ? mentionsIn(paragraphs[0].parentElement, author ? author.url : "") : [],
      comments_text: labels.find((label) => COMMENTS_LABEL.test(label)) || "",
      reactions_text: reaction ? labelOf(reaction) : "",
      shares_text: labels.find((label) => SHARES_LABEL.test(label)) || "",
      action_bar: labels.some((label) => /^comment$/i.test(label))
    });
  }
  if (out.posts.length === 0) out.diag = pageDiag();
  return out;
})()`;
}

/** A comment as the post's page drew it. */
export interface RawComment {
  /** The comment id from its ?comment_id= link, or "". */
  id: string;
  author: string;
  author_id: string;
  author_url: string;
  text: string;
  time_text: string;
  mentions: RawMention[];
  /** "View 3 replies", "3 replies", or "". */
  replies_text: string;
}

export interface ThreadSnapshot {
  url: string;
  gate: Gate;
  /** The post's own comment count, as drawn on its page. */
  comments_text: string;
  comments: RawComment[];
  diag?: PageDiag;
}

/** threadScript reads the top-level comments on a post's own page. Facebook
 *  labels each one "Comment by <name> …" and each reply "Reply by …"; replies
 *  are left out, since they answer a comment rather than the post. With no
 *  labelled comment on the page (another language, a new layout), the
 *  articles nested under the post are read instead.
 *
 *  A comment's id is in its timestamp link: ?comment_id=<id>, sometimes
 *  written base64 as "comment:<post>_<id>". */
export function threadScript(): string {
  return String.raw`(() => {${GATE_HELPER}${DIAG_HELPER}${LINK_HELPER}
  const out = { url: location.href, gate: gate(), comments_text: "", comments: [] };
  const all = Array.from(document.querySelectorAll('[role="article"]'));
  let comments = all.filter((node) => /^comment by /i.test(node.getAttribute("aria-label") || ""));
  if (comments.length === 0) {
    comments = all.filter((node) => node.parentElement && node.parentElement.closest('[role="article"]')
      && !/^reply by /i.test(node.getAttribute("aria-label") || ""));
  }
  const inComment = (node) => all.some((article) => article.contains(node) && comments.indexOf(article) >= 0);
  for (const node of Array.from(document.querySelectorAll("span, div, a, [role='button']"))) {
    const label = labelOf(node);
    if (label.length <= 60 && COMMENTS_LABEL.test(label) && !inComment(node)) { out.comments_text = label; break; }
  }
  const commentIdOf = (href) => {
    const url = absolute(href);
    if (!onFacebook(url)) return "";
    const raw = String(url.searchParams.get("comment_id") || "");
    if (/^\d{1,25}$/.test(raw)) return raw;
    try {
      const decoded = atob(raw);
      const match = /^comment:\d+_(\d{1,25})$/.exec(decoded);
      return match ? match[1] : "";
    } catch (error) { return ""; }
  };
  const own = (comment, selector) => Array.from(comment.querySelectorAll(selector)).filter((node) => {
    for (let current = node.parentElement; current && current !== comment; current = current.parentElement) {
      if (current.getAttribute("role") === "article") return false;
    }
    return node.getAttribute("role") !== "article";
  });
  const seen = new Set();
  for (const comment of comments) {
    let id = "";
    let timeText = "";
    for (const link of own(comment, 'a[href*="comment_id="]')) {
      const found = commentIdOf(link.getAttribute("href"));
      if (!found) continue;
      if (!id) id = found;
      const label = labelOf(link);
      if (found === id && !timeText && label && label.length <= 40) timeText = label;
    }
    let author = null;
    for (const link of own(comment, "a[href]")) {
      const profile = profileOf(link.getAttribute("href"));
      const name = labelOf(link);
      if (profile && name && name.length <= 80) { author = { name: name, id: profile.id, url: profile.url }; break; }
    }
    if (!author) {
      const label = /^comment by (.+?)(?:\s+(?:\d+|an?)\s+\w+\s+ago|\s+yesterday.*|\s+just now)?$/i.exec(comment.getAttribute("aria-label") || "");
      if (label) author = { name: label[1].trim().slice(0, 80), id: "", url: "" };
    }
    const pieces = [];
    for (const node of own(comment, 'div[dir="auto"], span[dir="auto"]')) {
      if (node.parentElement && node.parentElement.closest('div[dir="auto"], span[dir="auto"]') && comment.contains(node.parentElement.closest('div[dir="auto"], span[dir="auto"]'))) continue;
      if (node.closest("a[href]")) continue;
      const value = textOf(node);
      if (value && (!author || value !== author.name) && pieces.indexOf(value) < 0) pieces.push(value);
    }
    const text = pieces.join("\n").slice(0, ${TEXT_MAX});
    const key = id || ((author ? author.name : "") + "|" + text);
    if (!text && !id) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const textRoot = own(comment, 'div[dir="auto"]')[0] || comment;
    const replies = own(comment, "span, div, [role='button']").map((node) => labelOf(node))
      .find((label) => label.length <= 40 && /^(?:view (?:all )?)?\d+\s+repl(?:y|ies)$/i.test(label)) || "";
    out.comments.push({
      id: id,
      author: author ? author.name : "",
      author_id: author ? author.id : "",
      author_url: author ? author.url : "",
      text: text,
      time_text: timeText,
      mentions: mentionsIn(textRoot, author ? author.url : ""),
      replies_text: replies
    });
  }
  if (out.comments.length === 0) out.diag = pageDiag();
  return out;
})()`;
}

/** Where scrollScript left the page. */
export interface ScrollState {
  before: number;
  after: number;
  height: number;
}

/** scrollScript advances the page by most of a viewport, which makes
 *  Facebook load the next posts of the feed, and says whether it moved. */
export function scrollScript(): string {
  return `(() => {
  const before = window.scrollY;
  const distance = Math.max(Math.floor(window.innerHeight * 0.8), 600);
  window.scrollBy(0, distance);
  return { before: before, after: window.scrollY, height: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) };
})()`;
}

/** Every script with a label, for the tests that make sure each one is at
 *  least a valid expression. */
export function allScripts(): Record<string, string> {
  return {
    health: pageHealthScript(),
    exists: existsScript(FEED_READY_SELECTOR),
    identity: identityScript(),
    feed: groupFeedScript(),
    mobileFeed: mobileGroupScript(),
    thread: threadScript(),
    scroll: scrollScript(),
  };
}
