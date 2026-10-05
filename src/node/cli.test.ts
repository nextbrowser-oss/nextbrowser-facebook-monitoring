import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PassSummary } from "../engine.js";
import type { FacebookItem } from "../items.js";
import { emptyState } from "../state.js";
import { describeEvent, describePass, exitCode, parseDuration, settingsFromFlags } from "./cli.js";
import { loadState, saveState } from "./store.js";

describe("parseDuration", () => {
  it("reads the durations the flags take", () => {
    expect(parseDuration("30m", "--x")).toBe(1_800_000);
    expect(parseDuration("72h", "--x")).toBe(259_200_000);
    expect(() => parseDuration("soon", "--interval")).toThrow("--interval");
  });
});

describe("settingsFromFlags", () => {
  it("patches only what was given, and the negative flag wins", () => {
    expect(settingsFromFlags({})).toEqual({});
    expect(settingsFromFlags({ "no-comments": true, comments: true, "all-posts": true, "keep-tab": true })).toEqual({ watchComments: false, reportAllPosts: true, parkTab: false });
    expect(settingsFromFlags({ groups: "https://www.facebook.com/groups/acme.users/, 1234567890", keywords: "acme, acme billing", "max-comment-reads": "4", "max-scrolls": "2" })).toEqual({
      groups: ["acme.users", "1234567890"],
      keywords: ["acme", "acme billing"],
      maxCommentReads: 4,
      maxScrolls: 2,
    });
  });

  it("refuses something that is not a group", () => {
    expect(() => settingsFromFlags({ groups: "acme.users, https://www.facebook.com/acme" })).toThrow("not a Facebook group link or id");
  });
});

const group = { id: "acme.users", name: "Acme Users", url: "https://www.facebook.com/groups/acme.users/" };
const post = { id: "71", url: "https://www.facebook.com/groups/acme.users/posts/71/", author: "Lee Park", text: "Has anyone tried Acme?" };

function item(patch: Partial<FacebookItem>): FacebookItem {
  return { key: "post:71", id: "71", kind: "post", author: "Lee Park", text: "Has anyone tried Acme?", url: post.url, group, post, ...patch };
}

describe("describeEvent", () => {
  const at = new Date(2026, 9, 5, 9, 5).getTime();

  it("writes a match on two lines: who, where and how urgent, then why and the link", () => {
    const line = describeEvent({
      type: "new_item",
      at,
      source: { kind: "group_post", name: "Acme Users", group: "acme.users" },
      keywords: ["acme"],
      triage: { urgency: "medium", score: 2, reasons: ["Asks a question", "No comments yet"] },
      item: item({ replies: 0 }),
    });
    expect(line).toBe("09:05  MEDIUM  Lee Park posted in Acme Users: Has anyone tried Acme?\n        [Asks a question · No comments yet]  https://www.facebook.com/groups/acme.users/posts/71/");
  });

  it("names the post a comment is under, and the account's own", () => {
    const comment = (addressed?: "mention" | "comment_on_post") => describeEvent({
      type: "new_item",
      at,
      source: { kind: "group_comment", name: "Acme Users", group: "acme.users" },
      keywords: [],
      triage: { urgency: "low", score: 0, reasons: [] },
      item: item({ key: "comment:9", id: "9", kind: "comment", author: "Bo Chen", text: "acme is cheaper", url: `${post.url}?comment_id=9`, ...(addressed ? { addressed } : {}) }),
    });
    expect(comment()).toContain("Bo Chen commented on Lee Park's post in Acme Users: acme is cheaper");
    expect(comment("comment_on_post")).toContain("Bo Chen commented on your post in Acme Users");
    expect(comment("mention")).toContain("Bo Chen mentioned you in a comment in Acme Users");
    expect(describeEvent({ type: "security_check", at, name: "Dana Reyes" })).toContain("open facebook.com in the profile");
  });
});

describe("describePass", () => {
  const summary: PassSummary = {
    signedIn: true, account: "Dana Reyes", loginRequired: false, securityCheck: false, rateLimited: false, pagesLoaded: 5,
    groupsRead: 3, baselines: 0, fallbacks: 1, unreadable: 0, postsRead: 40, scrolls: 4, matches: 6, newItems: 2, urgent: 1,
    commentReads: 1, commentReadsDeferred: 0, stopped: false, failed: false, notes: [],
  };

  it("sums a pass up in one line", () => {
    expect(describePass(summary, new Date(2026, 9, 5, 21, 5).getTime()))
      .toBe("21:05  pass Dana Reyes: 3 groups: 2 new (1 urgent) of 6 matches; 1 via m.facebook.com; 1 thread read");
  });

  it("says what stopped it", () => {
    const line = describePass({ ...summary, groupsRead: 0, fallbacks: 0, commentReads: 0, rateLimited: true, notes: ["Wait it out."] }, new Date(2026, 9, 5, 9, 0).getTime());
    expect(line).toBe("09:00  pass Dana Reyes: temporarily blocked\n        Wait it out.");
  });
});

describe("exitCode", () => {
  const summary = {
    signedIn: true, loginRequired: false, securityCheck: false, rateLimited: false, pagesLoaded: 1,
    groupsRead: 1, baselines: 0, fallbacks: 0, unreadable: 0, postsRead: 3, scrolls: 0, matches: 0, newItems: 0, urgent: 0,
    commentReads: 0, commentReadsDeferred: 0, stopped: false, failed: false, notes: [],
  } satisfies PassSummary;

  it("says how a pass under once ended", () => {
    expect(exitCode(summary)).toBe(0);
    expect(exitCode({ ...summary, failed: true, notes: ["The pass failed: the tab crashed"] })).toBe(1);
    expect(exitCode({ ...summary, signedIn: false, loginRequired: true })).toBe(3);
    expect(exitCode({ ...summary, rateLimited: true, blocked: "blocked" })).toBe(4);
    expect(exitCode({ ...summary, securityCheck: true, blocked: "check" })).toBe(5);
  });
});

describe("the state file", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("round-trips, and refuses a file it cannot read", async () => {
    dir = await mkdtemp(join(tmpdir(), "facebook-monitor-"));
    const path = join(dir, "nested", "state.json");
    expect(await loadState(path)).toEqual(emptyState());
    const state = { ...emptyState({ groups: ["acme.users"] }), seen: ["post:1"] };
    await saveState(path, state);
    expect(await loadState(path)).toEqual(state);
    await writeFile(path, "{ not json");
    await expect(loadState(path)).rejects.toThrow();
  });
});
