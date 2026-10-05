// The pure rules: ids and links, drawn times and counts, items, keyword
// matching, urgency triage, and the state document.

import { describe, expect, it } from "vitest";
import { commentCount, parseCount, reactionCount } from "./counts.js";
import { commentUrl, feedUrl, groupKey, mobileFeedUrl, normalizeGroup, postIdFromUrl, postUrl } from "./ids.js";
import { commentItem, commentKey, groupContext, isOwn, mentionsAccount, normalizePosts, postItem } from "./items.js";
import { keywordMatcher } from "./keywords.js";
import { scheduleDelay } from "./schedule.js";
import { emptyState, normalizeSettings, normalizeState } from "./state.js";
import { drawnTimeRange } from "./times.js";
import { DEFAULT_URGENT_TERMS, byUrgency, triage } from "./triage.js";
import { NOON, rawComment, rawPost } from "./testing/fakeBrowser.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("ids", () => {
  it("read a group in every form a person pastes it", () => {
    for (const value of [
      "acme.users",
      "https://www.facebook.com/groups/acme.users/",
      "https://facebook.com/groups/acme.users?ref=share",
      "m.facebook.com/groups/acme.users/permalink/123/",
      "https://web.facebook.com/groups/acme.users#top",
    ]) {
      expect(normalizeGroup(value), value).toBe("acme.users");
    }
    expect(normalizeGroup("1234567890")).toBe("1234567890");
    expect(normalizeGroup("https://www.facebook.com/acme")).toBe("");
    expect(normalizeGroup("not a group")).toBe("");
    expect(groupKey("Acme.Users")).toBe("group:acme.users");
  });

  it("make the links a person opens", () => {
    expect(feedUrl("acme.users")).toBe("https://www.facebook.com/groups/acme.users/?sorting_setting=CHRONOLOGICAL");
    expect(mobileFeedUrl("acme.users")).toBe("https://m.facebook.com/groups/acme.users/");
    expect(postUrl("acme.users", "7100000000000001")).toBe("https://www.facebook.com/groups/acme.users/posts/7100000000000001/");
    expect(commentUrl("acme.users", "7100000000000001", "92")).toBe("https://www.facebook.com/groups/acme.users/posts/7100000000000001/?comment_id=92");
  });

  it("read a post id out of every permalink shape, keeping it whole", () => {
    expect(postIdFromUrl("https://www.facebook.com/groups/1/posts/7100000000000000001/?__cft__[0]=x")).toBe("7100000000000000001");
    expect(postIdFromUrl("/groups/acme.users/permalink/7100000000000001/")).toBe("7100000000000001");
    expect(postIdFromUrl("https://www.facebook.com/groups/acme.users/?multi_permalinks=7100000000000002,7100000000000009")).toBe("7100000000000002");
    expect(postIdFromUrl("https://m.facebook.com/story.php?story_fbid=7100000000000004&id=1234567890")).toBe("7100000000000004");
    expect(postIdFromUrl("https://www.facebook.com/groups/1/posts/pfbid02abcdefghijKLMNOP/")).toBe("pfbid02abcdefghijKLMNOP");
    expect(postIdFromUrl("https://www.facebook.com/groups/1/")).toBe("");
  });
});

describe("drawn times", () => {
  const at = NOON;

  it("become a range: the label is a floor, not a point", () => {
    expect(drawnTimeRange("3h", at)).toEqual({ earliest: at - 4 * HOUR, latest: at - 3 * HOUR });
    expect(drawnTimeRange("2 hrs", at)).toEqual({ earliest: at - 3 * HOUR, latest: at - 2 * HOUR });
    expect(drawnTimeRange("5m", at)).toEqual({ earliest: at - 6 * MINUTE, latest: at - 5 * MINUTE });
    expect(drawnTimeRange("an hour ago", at)).toEqual({ earliest: at - 2 * HOUR, latest: at - HOUR });
    expect(drawnTimeRange("1d", at)).toEqual({ earliest: at - 2 * DAY, latest: at - DAY });
    expect(drawnTimeRange("2w", at)?.latest).toBe(at - 14 * DAY);
    expect(drawnTimeRange("Just now", at)).toEqual({ earliest: at - MINUTE, latest: at });
  });

  it("take Yesterday as the last two days: the profile's time zone is not the machine's", () => {
    expect(drawnTimeRange("Yesterday", at)).toEqual({ earliest: at - 2 * DAY, latest: at });
    expect(drawnTimeRange("Yesterday at 10:15", at)).toEqual({ earliest: at - 2 * DAY, latest: at });
  });

  it("leave a date, a scrambled label and another language alone", () => {
    expect(drawnTimeRange("September 30 at 10:15", at)).toBeUndefined();
    expect(drawnTimeRange("oSnpdsreto", at)).toBeUndefined();
    expect(drawnTimeRange("3 ч", at)).toBeUndefined();
    expect(drawnTimeRange("", at)).toBeUndefined();
  });
});

describe("drawn counts", () => {
  it("read comment counts exact and rounded", () => {
    expect(commentCount("23 comments")).toBe(23);
    expect(commentCount("1 comment")).toBe(1);
    expect(commentCount("1.2K comments")).toBe(1200);
    expect(commentCount("")).toBeUndefined();
    expect(parseCount("2,3 тыс.")).toEqual({ value: 2300, approximate: true });
  });

  it("read reactions in each form Facebook draws them", () => {
    expect(reactionCount("1.2K")).toBe(1200);
    expect(reactionCount("You and 12 others")).toBe(13);
    expect(reactionCount("Mila Novak and 1 other")).toBe(2);
    expect(reactionCount("Mila Novak")).toBe(1);
    expect(reactionCount("")).toBeUndefined();
  });
});

const group = groupContext("acme.users", "Acme Users");
const account = { id: "100001", name: "Dana Reyes" };

describe("items", () => {
  it("carry the group and the post, and link with the configured group", () => {
    const [post] = normalizePosts([rawPost("1234567890", "Mila Novak", "Our   team\nloves it", { comments_text: "3 comments", time_text: "2h" })], group, NOON);
    expect(post!.url).toBe(postUrl("acme.users", post!.id));
    const item = postItem(post!);
    expect(item).toMatchObject({
      key: `post:${post!.id}`,
      group: { id: "acme.users", name: "Acme Users", url: "https://www.facebook.com/groups/acme.users/" },
      post: { id: post!.id, author: "Mila Novak", text: "Our team loves it" },
      replies: 3,
      createdAt: NOON - 3 * HOUR,
      timeText: "2h",
    });
    const comment = commentItem(rawComment("Bo Chen", "agreed", { id: "92" }), post!, NOON);
    expect(comment).toMatchObject({ key: "comment:92", url: `${post!.url}?comment_id=92`, post: { id: post!.id, author: "Mila Novak" } });
  });

  it("count no comments only where the action bar says so", () => {
    const [drawn, unknown] = normalizePosts([
      rawPost("g", "A", "a", { action_bar: true }),
      rawPost("g", "B", "b", { action_bar: false }),
    ], group, NOON);
    expect(drawn!.comments).toBe(0);
    expect(unknown!.comments).toBeUndefined();
  });

  it("key a comment the page drew no id for by what it says", () => {
    const raw = rawComment("Bo Chen", "agreed", { id: "" });
    expect(commentKey(raw, "71")).toBe(commentKey({ ...raw }, "71"));
    expect(commentKey(raw, "71")).toMatch(/^comment:71:[a-z0-9]+$/);
  });

  it("know the account's own posts by id, and by name when no id was drawn", () => {
    expect(isOwn({ author: "Someone Else", authorId: "100001" }, account)).toBe(true);
    expect(isOwn({ author: "Dana Reyes", authorId: "555" }, account)).toBe(false);
    expect(isOwn({ author: "dana reyes" }, account)).toBe(true);
  });

  it("find a mention by tag or by the full name, never by a first name", () => {
    expect(mentionsAccount("thanks!", [{ name: "D.", id: "100001", url: "" }], account)).toBe(true);
    expect(mentionsAccount("ask Dana Reyes about it", [], account)).toBe(true);
    expect(mentionsAccount("ask Dana about it", [], account)).toBe(false);
    expect(mentionsAccount("Dana Reyesova wrote", [], account)).toBe(false);
  });
});

describe("keywords", () => {
  it("count a hashtag as a word, and nothing inside a longer word", () => {
    const match = keywordMatcher(["acme"]);
    expect(match("loving #acme today")).toEqual(["acme"]);
    expect(match("acmeshop")).toEqual([]);
  });
});

const urgent = keywordMatcher([...DEFAULT_URGENT_TERMS]);
const [post] = normalizePosts([rawPost("g", "Mila Novak", "Is Acme down? Can't log in", { comments_text: "" })], group, NOON);

describe("triage", () => {
  it("ranks a keyword post with an urgent term and no comments high", () => {
    expect(triage(postItem(post!), { keywords: ["acme"], urgent })).toEqual({
      urgency: "high", score: 5, reasons: ['Says "can\'t log in"', "Asks a question", "No comments yet"],
    });
  });

  it("counts an urgent term only in an item about you", () => {
    const item = postItem(post!);
    expect(triage(item, { keywords: [], urgent }).reasons).toEqual(["Asks a question", "No comments yet"]);
  });

  it("ranks a mention high and a comment on your post medium", () => {
    const comment = commentItem(rawComment("Kim Ito", "thanks for this"), post!, NOON, "comment_on_post")!;
    expect(triage(comment, { keywords: [], urgent })).toEqual({ urgency: "medium", score: 2, reasons: ["On your post"] });
    const mention = commentItem(rawComment("Kim Ito", "Dana Reyes see this"), post!, NOON, "mention")!;
    expect(triage(mention, { keywords: [], urgent }).urgency).toBe("high");
  });

  it("calls a request for a recommendation a lead, not an emergency", () => {
    const comment = commentItem(rawComment("Lee Park", "We need to recommend an alternative to Acme to our team"), post!, NOON)!;
    expect(triage(comment, { keywords: ["acme"], urgent })).toEqual({ urgency: "low", score: 1, reasons: ["Asks for a recommendation"] });
  });

  it("notices a post picking up fast", () => {
    const [busy] = normalizePosts([rawPost("g", "A", "launch day", { comments_text: "140 comments" })], group, NOON);
    expect(triage(postItem(busy!), { keywords: [], urgent, gained: 35 }).reasons).toEqual(["35 comments since the last pass"]);
    expect(triage(postItem(busy!), { keywords: [], urgent, gained: 29 }).reasons).toEqual([]);
  });

  it("sorts most urgent first, then newest", () => {
    const entry = (hoursAgo: number, urgency: "high" | "low", score: number) => {
      const [made] = normalizePosts([rawPost("g", "A", String(hoursAgo), { time_text: `${hoursAgo}h` })], group, NOON);
      return { item: postItem(made!), triage: { urgency, score, reasons: [] } };
    };
    expect([entry(3, "low", 0), entry(2, "high", 4), entry(1, "low", 0)].sort(byUrgency).map((e) => e.item.text)).toEqual(["2", "1", "3"]);
  });
});

describe("state", () => {
  it("clamps settings to safe ranges", () => {
    const settings = normalizeSettings({
      maxCommentReads: 500, maxScrolls: 99,
      groups: ["acme.users", "https://www.facebook.com/groups/ACME.USERS/", "bad group", ...Array.from({ length: 12 }, (_, i) => `g${i}`)],
    });
    expect(settings).toMatchObject({ maxCommentReads: 10, maxScrolls: 6 });
    expect(settings.groups).toHaveLength(10);
    expect(settings.groups[0]).toBe("acme.users");
    expect(normalizeSettings({}).maxItemAgeMs).toBe(72 * HOUR);
    expect(normalizeSettings({ urgentTerms: [] }).urgentTerms).toEqual([]);
    expect(normalizeSettings({}).urgentTerms).toEqual(DEFAULT_URGENT_TERMS);
  });

  it("takes a setting left empty as its default, not as zero", () => {
    const settings = normalizeSettings({ maxItemAgeMs: null, maxCommentReads: null, maxScrolls: "" } as never);
    expect(settings).toMatchObject({ maxItemAgeMs: 72 * HOUR, maxCommentReads: 5, maxScrolls: 3 });
    expect(normalizeSettings({ maxItemAgeMs: 0, maxCommentReads: 0 })).toMatchObject({ maxItemAgeMs: 0, maxCommentReads: 0 });
  });

  it("accepts whatever was on disk", () => {
    expect(normalizeState(null)).toEqual(emptyState());
    const state = normalizeState({
      account: { id: "100001", name: "Dana Reyes", signedIn: true, checkedAt: 5 },
      sources: { "group:acme.users": { since: 1, name: "Acme Users" }, "group:bad group": { since: 1 }, other: { since: 1 } },
      posts: {
        "7100000000000001": { group: "acme.users", own: false, comments: 2, checkedAt: 1 },
        "7100000000000002": { group: "acme.users", own: false, comments: 4, shortReads: 2, checkedAt: 2 },
        junk: { comments: 1 },
      },
      seen: ["post:1", 2],
    });
    expect(state.account).toEqual({ id: "100001", name: "Dana Reyes", signedIn: true, checkedAt: 5 });
    expect(Object.keys(state.sources)).toEqual(["group:acme.users"]);
    expect(Object.keys(state.posts)).toEqual(["7100000000000001", "7100000000000002"]);
    expect(state.posts["7100000000000001"]?.shortReads).toBeUndefined();
    expect(state.posts["7100000000000002"]?.shortReads).toBe(2);
    expect(state.seen).toEqual(["post:1"]);
  });
});

describe("scheduleDelay", () => {
  it("spreads the interval, never goes under fifteen minutes, and backs off after a stop", () => {
    expect(scheduleDelay(30 * MINUTE, { random: () => 0.5 })).toBe(30 * MINUTE);
    expect(scheduleDelay(MINUTE, { random: () => 0.5 })).toBe(15 * MINUTE);
    expect(scheduleDelay(30 * MINUTE, { random: () => 0.5, backOff: true })).toBe(90 * MINUTE);
  });
});
