import { beforeEach, describe, expect, it } from "vitest";
import { checkAccount, runPass, type PassDeps, type PassResult } from "./engine.js";
import type { MonitorEvent, NewItemEvent } from "./events.js";
import { feedUrl, mobileFeedUrl, postUrl } from "./ids.js";
import type { RawComment, RawPost } from "./scripts.js";
import { SIGN_IN_URL } from "./scripts.js";
import { MAX_SEEN, emptyState, withSettings, type MonitorSettings, type MonitorState } from "./state.js";
import { FakeFacebook, NOON, rawComment, rawPost } from "./testing/fakeBrowser.js";

const MINUTE = 60_000;
const GROUP = "acme.users";

let clock = NOON;
let fb: FakeFacebook;
let sleeps: number[];
let older: RawPost;
let question: RawPost;

beforeEach(() => {
  clock = NOON;
  sleeps = [];
  fb = new FakeFacebook();
  older = rawPost(GROUP, "Sam Ortiz", "Weekly thread: what are you working on?");
  question = rawPost(GROUP, "Lee Park", "Has anyone tried Acme for team billing?", { comments_text: "2 comments" });
  fb.groups[GROUP] = { name: "Acme Users", posts: [question, older] };
});

function pass(state: MonitorState, extra: Partial<PassDeps> = {}): Promise<PassResult> {
  return runPass({
    browser: fb,
    state,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0.5,
    ...extra,
  });
}

function watching(patch: Partial<MonitorSettings> = {}): MonitorState {
  return emptyState({ groups: [GROUP], keywords: ["acme"], ...patch });
}

const types = (events: MonitorEvent[]) => events.map((event) => event.type);
const fresh = (events: MonitorEvent[]) => events.filter((event): event is NewItemEvent => event.type === "new_item");
const texts = (events: MonitorEvent[]) => fresh(events).map((event) => event.item.text);

/** later moves the clock to the next pass. */
function later(minutes = 30): void {
  clock += minutes * MINUTE;
}

/** publish puts new posts on top of a group's chronological feed. */
function publish(group: string, ...posts: RawPost[]): void {
  fb.groups[group]!.posts = [...posts, ...fb.groups[group]!.posts];
}

/** grow adds comments under a post and raises the count its feed unit draws. */
function grow(target: RawPost, ...added: RawComment[]): void {
  fb.comments[target.id] = [...(fb.comments[target.id] ?? []), ...added];
  const count = (Number.parseInt(target.comments_text, 10) || 0) + added.length;
  target.comments_text = `${count} comments`;
}

describe("the first pass", () => {
  it("signs in, records the group as its starting line, and announces nothing", async () => {
    const { state, events, summary, matches } = await pass(watching());

    expect(types(events)).toEqual(["signed_in"]);
    expect(events[0]).toEqual({ type: "signed_in", at: NOON, name: "Dana Reyes", id: "100001" });
    expect(summary).toMatchObject({ signedIn: true, account: "Dana Reyes", groupsRead: 1, baselines: 1, newItems: 0, commentReads: 0 });
    // A first read scrolls a little for the matches it lists, never more.
    expect(summary.scrolls).toBeLessThanOrEqual(2);
    expect(state.sources["group:acme.users"]).toMatchObject({ since: NOON, name: "Acme Users" });
    expect(state.seen).toEqual([`post:${question.id}`, `post:${older.id}`]);
    // The keyword post is watched from here on, at the count it has now.
    expect(state.posts[question.id]).toMatchObject({ group: GROUP, own: false, comments: 2 });
    // The dashboard still gets what matched.
    expect(matches.map((match) => match.item.text)).toEqual(["Has anyone tried Acme for team billing?"]);
    expect(fb.opened).toEqual([feedUrl(GROUP), "about:blank"]);
  });

  it("scrolls a little on a first read, so matches below the first posts are listed", async () => {
    fb.pageSize = 1;
    const { matches, events, summary } = await pass(watching());
    expect(summary.scrolls).toBeGreaterThan(0);
    expect(matches.map((match) => match.item.text)).toContain("Has anyone tried Acme for team billing?");
    expect(types(events)).toEqual(["signed_in"]);
  });

  it("brings a hidden profile window to the front once, so the feed loads", async () => {
    fb.hidden = true;
    const { matches } = await pass(watching());
    expect(fb.broughtToFront).toBe(1);
    expect(matches.map((match) => match.item.text)).toContain("Has anyone tried Acme for team billing?");
  });

  it("never mutates the state it was given", async () => {
    const given = watching();
    const copy = structuredClone(given);
    await pass(Object.freeze(given));
    later();
    publish(GROUP, rawPost(GROUP, "Ana Lima", "acme pricing?"));
    await pass(Object.freeze(given));
    expect(given).toEqual(copy);
  });

  it("opens nothing without groups, and says what to add", async () => {
    const { summary } = await pass(emptyState({ keywords: ["acme"] }));
    expect(fb.opened).toEqual([]);
    expect(summary.notes).toEqual(["No groups to watch: add up to 10 group links."]);
  });
});

describe("new posts", () => {
  it("announces a keyword post with its group and post context", async () => {
    const first = await pass(watching());
    later();
    const post = rawPost(GROUP, "Mila Novak", "Is Acme down for anyone else? Can't log in since noon", { comments_text: "" });
    publish(GROUP, post);
    const { events, summary } = await pass(first.state);

    expect(fresh(events)).toHaveLength(1);
    expect(fresh(events)[0]).toMatchObject({
      account: "Dana Reyes",
      source: { kind: "group_post", name: "Acme Users", group: GROUP },
      keywords: ["acme"],
      item: {
        key: `post:${post.id}`,
        kind: "post",
        author: "Mila Novak",
        url: postUrl(GROUP, post.id),
        group: { id: GROUP, name: "Acme Users", url: "https://www.facebook.com/groups/acme.users/" },
        post: { id: post.id, url: postUrl(GROUP, post.id), author: "Mila Novak", text: "Is Acme down for anyone else? Can't log in since noon" },
        replies: 0,
      },
      triage: { urgency: "high", reasons: ['Says "can\'t log in"', "Asks a question", "No comments yet"] },
    });
    expect(summary).toMatchObject({ newItems: 1, urgent: 1, baselines: 0 });
  });

  it("tells new from old by the feed position when Facebook draws no readable time", async () => {
    fb.pageSize = 2;
    const deep = rawPost(GROUP, "Old Timer", "acme was great in 2019");
    fb.groups[GROUP]!.posts.push(deep);
    // The first read does not scroll here, so the deep post stays unseen.
    const first = await pass(watching({ maxScrolls: 0 }));
    expect(first.state.seen).not.toContain(`post:${deep.id}`);
    later();
    publish(GROUP, rawPost(GROUP, "Ana Lima", "acme or the other one?"), rawPost(GROUP, "Bo Chen", "acme export is broken"));
    const { events, summary } = await pass(withSettings(first.state, { maxScrolls: 5 }));

    // Both new posts sit above the newest post the first pass saw. The old
    // one the first pass never scrolled to sits below it: not new.
    expect(texts(events)).toEqual(["acme export is broken", "acme or the other one?"]);
    expect(summary.scrolls).toBeGreaterThan(0);
    expect(summary.postsRead).toBe(5);
  });

  it("keeps a resurfaced post out when its drawn time is older than the starting line", async () => {
    const first = await pass(watching());
    later();
    publish(GROUP, rawPost(GROUP, "Admin", "Pinned: acme FAQ", { time_text: "2d" }), rawPost(GROUP, "Ana Lima", "acme question", { time_text: "5m" }));
    const { events } = await pass(first.state);
    expect(texts(events)).toEqual(["acme question"]);
  });

  it("dates a post by its time when the read never got back to known posts", async () => {
    fb.pageSize = 3;
    const first = await pass(watching({ maxScrolls: 0 }));
    later();
    publish(GROUP,
      rawPost(GROUP, "A", "acme one", { time_text: "3m" }),
      rawPost(GROUP, "B", "acme two"),
      rawPost(GROUP, "C", "acme three", { time_text: "20m" }));
    const { events, summary } = await pass(first.state);
    expect(texts(events)).toEqual(["acme three", "acme one"]);
    expect(summary.notes.some((note) => note.includes("did not get back to posts seen before"))).toBe(true);
  });

  it("drops a post with an exclusion word, unless it mentions the account", async () => {
    const first = await pass(watching({ excludeKeywords: ["giveaway"] }));
    later();
    publish(GROUP,
      rawPost(GROUP, "Spam Bot", "acme giveaway click here"),
      rawPost(GROUP, "Kim Ito", "Dana Reyes, is the acme giveaway real?"));
    const { events } = await pass(first.state);
    expect(texts(events)).toEqual(["Dana Reyes, is the acme giveaway real?"]);
  });

  it("ranks a post that tags the account high, even without a keyword", async () => {
    const first = await pass(watching());
    later();
    publish(GROUP, rawPost(GROUP, "Kim Ito", "Dana Reyes can you share the onboarding doc?", {
      mentions: [{ name: "Dana Reyes", id: "100001", url: "https://www.facebook.com/profile.php?id=100001" }],
    }));
    const { events } = await pass(first.state);
    expect(fresh(events)[0]).toMatchObject({
      keywords: [],
      item: { addressed: "mention" },
      triage: { urgency: "high", reasons: ["Mentions you", "Asks a question", "No comments yet"] },
    });
  });

  it("reports only mentions without keywords, and every post with reportAllPosts", async () => {
    const quiet = await pass(watching({ keywords: [] }));
    expect(quiet.summary.notes[0]).toContain("Add keywords or turn on reportAllPosts");
    later();
    publish(GROUP, rawPost(GROUP, "Ana Lima", "Looking for a good invoicing tool, any suggestions?"));
    expect(fresh((await pass(quiet.state)).events)).toHaveLength(0);

    const all = await pass(watching({ keywords: [], reportAllPosts: true }));
    later();
    publish(GROUP, rawPost(GROUP, "Bo Chen", "Looking for a good invoicing tool, any suggestions?"));
    const { events } = await pass(all.state);
    expect(fresh(events)[0]).toMatchObject({ triage: { urgency: "medium", reasons: ["Asks a question", "Asks for a recommendation", "No comments yet"] } });
  });

  it("does not announce the account's own posts", async () => {
    const first = await pass(watching());
    later();
    publish(GROUP, rawPost(GROUP, "Dana Reyes", "acme 2.0 is out!", { author_id: "100001" }));
    expect(fresh((await pass(first.state)).events)).toHaveLength(0);
  });
});

describe("comments", () => {
  it("opens a keyword post only when its comment count grew, and announces a keyword comment once", async () => {
    const first = await pass(watching());
    later();
    expect(fb.threadsRead).toEqual([]);
    grow(question, rawComment("Bo Chen", "We moved off Acme last month, export kept failing"), rawComment("Ana Lima", "same here"));
    const second = await pass(first.state);

    expect(fb.threadsRead).toEqual([question.id]);
    expect(second.summary.commentReads).toBe(1);
    expect(fresh(second.events)).toHaveLength(1);
    const comment = fresh(second.events)[0]!;
    expect(comment).toMatchObject({
      source: { kind: "group_comment", name: "Acme Users", group: GROUP },
      keywords: ["acme"],
      item: {
        kind: "comment",
        author: "Bo Chen",
        group: { id: GROUP, name: "Acme Users" },
        post: { id: question.id, author: "Lee Park", text: "Has anyone tried Acme for team billing?" },
      },
    });
    expect(comment.item.url).toBe(`${postUrl(GROUP, question.id)}?comment_id=${comment.item.id}`);
    expect(second.state.posts[question.id]).toMatchObject({ comments: 4, threadReadAt: second.state.lastPass!.at });

    later();
    const third = await pass(second.state);
    expect(fb.threadsRead).toEqual([question.id]);
    expect(fresh(third.events)).toHaveLength(0);

    later();
    grow(question, rawComment("Cy Diaz", "acme support fixed it for us"));
    const fourth = await pass(third.state);
    expect(texts(fourth.events)).toEqual(["acme support fixed it for us"]);
  });

  it("treats every comment on the account's own post as addressed to it", async () => {
    const mine = rawPost(GROUP, "Dana Reyes", "We just shipped the new dashboard", { author_id: "100001", comments_text: "1 comment" });
    publish(GROUP, mine);
    const first = await pass(watching());
    later();
    grow(mine, rawComment("Kim Ito", "Where do I find the export button?"));
    const { events } = await pass(first.state);
    expect(fresh(events)[0]).toMatchObject({
      item: { kind: "comment", addressed: "comment_on_post", author: "Kim Ito" },
      triage: { urgency: "medium", reasons: ["On your post", "Asks a question"] },
    });
  });

  it("does not announce the comments an older post already had when it is first opened", async () => {
    fb.comments[question.id] = [rawComment("Early Bird", "acme is fine", { time_text: "3d" }), rawComment("Mid", "acme hmm")];
    const first = await pass(watching());
    later();
    grow(question, rawComment("Late", "acme just broke for me", { time_text: "4m" }));
    const { events } = await pass(first.state);
    expect(texts(events)).toEqual(["acme just broke for me"]);
  });

  it("opens no more posts than allowed, and catches up on the next pass", async () => {
    const other = rawPost(GROUP, "Kim Ito", "acme vs others for agencies", { comments_text: "1 comment" });
    publish(GROUP, other);
    const first = await pass(watching({ maxCommentReads: 1 }));
    later();
    grow(other, rawComment("A", "acme wins"));
    grow(question, rawComment("B", "acme billing is solid"));
    const middle = await pass(first.state);
    expect(texts(middle.events)).toEqual(["acme wins"]);
    expect(middle.summary).toMatchObject({ commentReads: 1, commentReadsDeferred: 1 });
    expect(middle.summary.notes).toContain("1 post with new comments waits for the next pass (maxCommentReads).");
    later();
    const last = await pass(middle.state);
    expect(texts(last.events)).toEqual(["acme billing is solid"]);
  });

  it("reads the comments of a post that is itself new", async () => {
    const first = await pass(watching());
    later();
    const post = rawPost(GROUP, "Ana Lima", "acme or not?");
    publish(GROUP, post);
    grow(post, rawComment("Bo Chen", "acme, no question"));
    const { events } = await pass(first.state);
    expect(texts(events)).toEqual(["acme or not?", "acme, no question"]);
  });

  it("keeps a new post's comments due when the pass stops before its page is read", async () => {
    const first = await pass(watching());
    later();
    const post = rawPost(GROUP, "Mila Novak", "anyone tried acme?");
    publish(GROUP, post);
    grow(post, rawComment("Ann Wu", "acme is great"), rawComment("Bob Ray", "acme broke for me"));
    let stop = false;
    const stopped = await pass(first.state, {
      shouldStop: () => stop,
      onStep: (step) => {
        if (step.startsWith("Reading comments")) stop = true;
      },
    });
    expect(stopped.summary.stopped).toBe(true);
    expect(texts(stopped.events)).toEqual(["anyone tried acme?"]);
    // Nothing of its comments was read: the watch says so.
    expect(stopped.state.posts[post.id]).toMatchObject({ comments: 0 });
    later();
    const { events } = await pass(stopped.state);
    expect(texts(events)).toEqual(["acme is great", "acme broke for me"]);
  });

  it("keeps the count where it was when the post's page drew none of the new comments", async () => {
    const post = rawPost(GROUP, "Mila Novak", "acme thread");
    publish(GROUP, post);
    const first = await pass(watching());
    expect(first.state.posts[post.id]).toMatchObject({ comments: 0 });
    later();
    // The count grew, but the page draws no comment: a slow load, or the
    // comments collapsed.
    post.comments_text = "2 comments";
    const empty = await pass(first.state);
    expect(fb.threadsRead).toEqual([post.id]);
    expect(empty.state.posts[post.id]).toMatchObject({ comments: 0, shortReads: 1 });
    later();
    fb.comments[post.id] = [rawComment("Ann Wu", "acme new one"), rawComment("Bob Ray", "acme two")];
    const { events, state } = await pass(empty.state);
    expect(texts(events)).toEqual(["acme new one", "acme two"]);
    expect(state.posts[post.id]).toMatchObject({ comments: 2 });
    expect(state.posts[post.id]?.shortReads).toBeUndefined();
  });

  it("takes the count as read after three opens that draw nothing new, and says why", async () => {
    const post = rawPost(GROUP, "Mila Novak", "acme thread");
    publish(GROUP, post);
    let state = (await pass(watching())).state;
    post.comments_text = "3 comments";
    const notes: string[][] = [];
    for (let read = 0; read < 3; read += 1) {
      later();
      const out = await pass(state);
      state = out.state;
      notes.push(out.summary.notes);
    }
    expect(fb.threadsRead).toEqual([post.id, post.id, post.id]);
    expect(state.posts[post.id]).toMatchObject({ comments: 3 });
    expect(state.posts[post.id]?.shortReads).toBeUndefined();
    expect(notes[1]!.some((note) => note.includes("drew fewer new comments"))).toBe(false);
    expect(notes[2]!.some((note) => note.includes("drew fewer new comments"))).toBe(true);
    later();
    await pass(state);
    expect(fb.threadsRead).toHaveLength(3);
  });

  it("moves the count only by the comments the page drew when Facebook shows its own pick", async () => {
    const first = await pass(watching());
    later();
    // Three new comments, of which the page's "Most relevant" order draws one.
    question.comments_text = "5 comments";
    const pick = rawComment("Ann Wu", "acme pick");
    fb.comments[question.id] = [pick];
    const second = await pass(first.state);
    expect(texts(second.events)).toEqual(["acme pick"]);
    expect(second.state.posts[question.id]).toMatchObject({ comments: 3, shortReads: 1 });
    later();
    fb.comments[question.id] = [pick, rawComment("Bob Ray", "acme hidden", { time_text: "10m" })];
    const third = await pass(second.state);
    expect(fb.threadsRead).toEqual([question.id, question.id]);
    expect(texts(third.events)).toEqual(["acme hidden"]);
  });

  it("reads no comments with watchComments off", async () => {
    const first = await pass(watching({ watchComments: false }));
    later();
    grow(question, rawComment("Bo Chen", "acme"));
    await pass(first.state);
    expect(fb.threadsRead).toEqual([]);
  });
});

describe("the m.facebook.com fallback", () => {
  it("reads a group through m.facebook.com when www draws no feed", async () => {
    const first = await pass(watching());
    fb.groups[GROUP]!.www = "blank";
    later();
    publish(GROUP, rawPost(GROUP, "Ana Lima", "acme API limits?"));
    const { events, summary, state } = await pass(first.state);
    expect(fb.opened.slice(-3)).toEqual([feedUrl(GROUP), mobileFeedUrl(GROUP), "about:blank"]);
    expect(texts(events)).toEqual(["acme API limits?"]);
    expect(summary).toMatchObject({ fallbacks: 1, groupsRead: 1, unreadable: 0 });
    expect(summary.notes).toContain("Acme Users was read through m.facebook.com: www.facebook.com drew no posts.");
    expect(state.sources["group:acme.users"]?.fallback).toBe(true);
  });

  it("notes a group neither site would draw, and goes on with the next one", async () => {
    fb.groups["other.group"] = { name: "Other Group", posts: [rawPost("other.group", "X", "acme here")] };
    const first = await pass(watching({ groups: [GROUP, "other.group"] }));
    fb.groups[GROUP]!.www = "unavailable";
    fb.groups[GROUP]!.mobile = "unavailable";
    later();
    publish("other.group", rawPost("other.group", "Y", "acme there"));
    const { events, summary, state } = await pass(first.state);
    expect(summary).toMatchObject({ unreadable: 1, groupsRead: 1 });
    expect(summary.notes).toContain("Acme Users is not available to this account: the link may be wrong, or the group was removed. It is skipped this pass.");
    expect(texts(events)).toEqual(["acme there"]);
    expect(state.sources["group:acme.users"]).toMatchObject({ since: NOON, note: expect.stringContaining("not available") });
  });
});

describe("degraded states", () => {
  it("stops at a signed-out profile, says so once, and picks up after a sign-in", async () => {
    const first = await pass(watching());
    fb.signedIn = false;
    later();
    const out = await pass(first.state);
    expect(types(out.events)).toEqual(["signed_out"]);
    expect(out.summary).toMatchObject({ signedIn: false, loginRequired: true, pagesLoaded: 1 });
    expect(out.state.sources).toEqual(first.state.sources);
    later();
    const still = await pass(out.state);
    expect(types(still.events)).toEqual([]);
    fb.signedIn = true;
    later();
    const back = await pass(still.state);
    expect(types(back.events)).toEqual(["signed_in"]);
  });

  it("takes a page with no session cookie and no account button as signed out", async () => {
    fb.anonymous = true;
    const { events, summary } = await pass(watching());
    expect(types(events)).toEqual(["signed_out"]);
    expect(summary).toMatchObject({ signedIn: false, loginRequired: true, groupsRead: 0 });
  });

  it("says a pass failed when something unexpected ended it", async () => {
    const first = await pass(watching());
    later();
    fb.failOn = "feed";
    const { summary } = await pass(first.state);
    expect(summary.failed).toBe(true);
    expect(summary.notes).toContain("The pass failed: the tab crashed");
    fb.failOn = "";
    later();
    expect((await pass(first.state)).summary.failed).toBe(false);
  });

  it("stops at a security check and asks for it to be done by hand", async () => {
    const first = await pass(watching());
    fb.checkpoint = true;
    later();
    const { events, summary } = await pass(first.state);
    expect(types(events)).toEqual(["security_check"]);
    expect(summary).toMatchObject({ securityCheck: true, pagesLoaded: 1 });
    expect(summary.blocked).toContain("security check");
    expect(fb.opened.at(-1)).toBe("about:blank");
  });

  it("stops when Facebook temporarily blocks the account, keeping what was read before", async () => {
    fb.groups["second"] = { name: "Second", posts: [rawPost("second", "Z", "hello")] };
    const first = await pass(watching({ groups: [GROUP, "second"] }));
    later();
    publish(GROUP, rawPost(GROUP, "Ana Lima", "acme?"));
    const { events, summary, state } = await pass(first.state, {
      onStep: (step) => {
        if (step.includes("Second")) fb.blocked = "You're Temporarily Blocked";
      },
    });
    expect(summary.rateLimited).toBe(true);
    expect(summary.blocked).toContain("You're Temporarily Blocked");
    expect(texts(events)).toEqual(["acme?"]);
    expect(state.sources["group:second"]).toEqual(first.state.sources["group:second"]);
  });

  it("notes a private group the account has not joined, and goes on", async () => {
    fb.groups["private.club"] = { name: "Private Club", posts: [], www: "not_member" };
    const { summary, state } = await pass(watching({ groups: ["private.club", GROUP] }));
    expect(summary.notes).toContain("You are not a member of group private.club: join it from this account, or remove it from the list.");
    expect(summary).toMatchObject({ unreadable: 1, groupsRead: 1 });
    expect(Object.keys(state.sources)).toEqual(["group:acme.users"]);
    expect(fb.opened).not.toContain(mobileFeedUrl("private.club"));
  });

  it("pauses like a person between page loads", async () => {
    const first = await pass(watching());
    later();
    grow(question, rawComment("Bo Chen", "acme"));
    sleeps = [];
    await pass(first.state);
    const pauses = sleeps.filter((ms) => ms >= 1000);
    expect(pauses.length).toBeGreaterThan(0);
    expect(pauses.every((ms) => ms >= 1200)).toBe(true);
    expect(pauses).toContain(6500);
  });
});

describe("the seen list", () => {
  it("keeps a post that stays in view at the newest end, so a full list never lets it be announced twice", async () => {
    const pinned = rawPost(GROUP, "Admin", "Pinned: acme FAQ");
    publish(GROUP, pinned);
    const first = await pass(watching());
    // A long history: the list is full, and the pinned post is its oldest key.
    const [top, ...rest] = first.state.seen;
    const filler = Array.from({ length: MAX_SEEN - first.state.seen.length }, (_, index) => `post:${index + 1}`);
    const full: MonitorState = { ...first.state, seen: [top!, ...filler, ...rest] };
    later();
    fb.groups[GROUP]!.posts.splice(1, 0, rawPost(GROUP, "Ana Lima", "acme news", { time_text: "5m" }));
    const second = await pass(full);
    expect(texts(second.events)).toEqual(["acme news"]);
    expect(second.state.seen).toHaveLength(MAX_SEEN);
    expect(second.state.seen).toContain(`post:${pinned.id}`);
    later();
    expect(texts((await pass(second.state)).events)).toEqual([]);
  });

  it("knows a post again by its numeric id after reading it by its pfbid", async () => {
    const pfbid = "pfbid02AbCdEfGhIjKlMnOp";
    const post = rawPost(GROUP, "Mila Novak", "acme by link", { id: pfbid });
    publish(GROUP, post);
    const first = await pass(watching());
    expect(first.state.seen).toContain(`post:${pfbid}`);
    later();
    // This read found the numeric id beside the pfbid one.
    post.id = "7199999999999999";
    post.alt_id = pfbid;
    const second = await pass(first.state);
    expect(texts(second.events)).toEqual([]);
    expect(second.state.seen).toEqual(expect.arrayContaining([`post:${pfbid}`, "post:7199999999999999"]));
    later();
    // m.facebook.com draws only the numeric id: still the same post.
    post.alt_id = "";
    fb.groups[GROUP]!.www = "blank";
    const third = await pass(second.state);
    expect(third.summary.fallbacks).toBe(1);
    expect(texts(third.events)).toEqual([]);
  });
});

describe("settings", () => {
  it("forgets a group that was removed, so adding it back starts over", async () => {
    const first = await pass(watching());
    expect(first.state.posts[question.id]).toBeDefined();
    later();
    const without = await pass(withSettings(first.state, { groups: [] }));
    expect(without.state.sources).toEqual({});
    expect(without.state.posts).toEqual({});
  });
});

describe("checkAccount", () => {
  it("opens facebook.com, says who is signed in, and leaves the page open", async () => {
    expect(await checkAccount({ browser: fb, sleep: async () => undefined })).toEqual({ signedIn: true, name: "Dana Reyes", id: "100001" });
    expect(fb.opened).toEqual([SIGN_IN_URL]);
    fb.signedIn = false;
    expect(await checkAccount({ browser: fb, sleep: async () => undefined })).toEqual({ signedIn: false });
    fb.checkpoint = true;
    expect(await checkAccount({ browser: fb, sleep: async () => undefined })).toEqual({ signedIn: false, securityCheck: true });
  });
});
