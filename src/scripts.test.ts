// @vitest-environment happy-dom
/// <reference lib="dom" />
//
// The page scripts run here against trimmed documents shaped like what
// facebook.com draws: a www group feed (posts as [role="article"] and as
// [aria-posinset] units, a comment preview nested inside a post), the
// server-drawn m.facebook.com group page, a post's own page with its comments,
// and the screens in front of a group — the sign-in wall, a security check,
// "You're Temporarily Blocked", a private group the account has not joined,
// and "This content isn't available right now". None has been captured from a
// live session yet: they follow the roles, attributes and link shapes the
// scripts rely on, with Facebook's generated class names left out, and a live
// run is still owed.

import { afterEach, describe, expect, it } from "vitest";
import {
  FEED_READY_SELECTOR,
  allScripts,
  existsScript,
  groupFeedScript,
  identityScript,
  mobileGroupScript,
  pageHealthScript,
  threadScript,
  type FeedSnapshot,
  type IdentitySnapshot,
  type PageHealth,
  type ThreadSnapshot,
} from "./scripts.js";

/** runAsync is run for a script that returns a promise, as Runtime.evaluate
 *  with awaitPromise does. */
async function runAsync<T>(script: string): Promise<T> {
  return JSON.parse(JSON.stringify(await (0, eval)(script))) as T;
}

function run<T>(script: string): T {
  // Indirect eval: the script runs in the page's global scope, as it would in
  // Runtime.evaluate, and comes back through JSON as it would over CDP.
  return JSON.parse(JSON.stringify((0, eval)(script))) as T;
}

function page(url: string, html: string): void {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
  document.body.innerHTML = html;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.cookie = "c_user=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
});

const GROUP_URL = "https://www.facebook.com/groups/acme.users/?sorting_setting=CHRONOLOGICAL";

const CHROME = `
  <div role="banner"><div role="button" aria-label="Your profile"><svg role="img" aria-label="Dana Reyes"></svg></div></div>`;

// Two feed units: one whose post is a [role="article"] with a comment preview
// nested in it, one drawn as a bare [aria-posinset] unit with a
// multi_permalinks link and no marked message.
const WWW_FEED = `${CHROME}
  <div role="main">
    <h1><a href="https://www.facebook.com/groups/acme.users/">Acme Users</a></h1>
    <span>Private group · 1.2K members</span>
    <span>Only members can see who's in the group and what they post.</span>
    <div role="feed">
      <div aria-posinset="1">
        <div role="article" aria-labelledby="h1">
          <h3><span><a href="https://www.facebook.com/groups/1234567890/user/100200/?__cft__[0]=AZ">Mila Novak</a></span></h3>
          <span><a href="https://www.facebook.com/groups/1234567890/posts/7100000000000001/?__cft__[0]=AZ" aria-label="3h"><span>3</span><span>h</span></a></span>
          <div data-ad-preview="message" data-ad-comet-preview="message">
            <div dir="auto">Is Acme down for anyone else? <a href="https://www.facebook.com/profile.php?id=100001">Dana Reyes</a> any idea?</div>
            <div dir="auto">Can't log in since noon <img alt="😩"> <div role="button">See more</div></div>
          </div>
          <div><span>All reactions:</span><span>1.2K</span></div>
          <div role="button"><span>23 comments</span></div>
          <div role="button"><span>4 shares</span></div>
          <div role="button" aria-label="Leave a comment"><span>Comment</span></div>
          <div role="article" aria-label="Comment by Bo Chen 2 hours ago">
            <a href="https://www.facebook.com/groups/1234567890/user/100300/">Bo Chen</a>
            <div dir="auto">acme export failed for me too</div>
            <a href="https://www.facebook.com/groups/1234567890/posts/7100000000000001/?comment_id=9200000000000001">2h</a>
            <span>5 comments</span>
          </div>
        </div>
      </div>
      <div aria-posinset="2">
        <strong><a href="https://www.facebook.com/profile.php?id=100400">Lee Park</a></strong>
        <a href="https://www.facebook.com/groups/acme.users/?multi_permalinks=7100000000000002">Yesterday at 10:15</a>
        <div dir="auto">Looking for an alternative to Acme, any suggestions?</div>
        <span>You and 12 others</span>
        <div role="button"><span>Comment</span></div>
      </div>
    </div>
  </div>`;

// m.facebook.com, drawn on the server: articles with data-ft, a <abbr> time,
// and "Full Story" links in both permalink shapes.
const MOBILE_FEED = `
  <div id="root">
    <h1>Acme Users</h1>
    <article data-ft='{"top_level_post_id":"7100000000000003","content_owner_id_new":"100500"}'>
      <header><h3><strong><a href="/groups/acme.users/user/100500/?refid=18">Ana Lima</a></strong></h3></header>
      <div data-ft='{"tn":"*s"}'><span><p>acme API limits? We hit 429s at 10 rps.</p></span></div>
      <footer>
        <abbr>2 hrs</abbr>
        <a href="/ufi/reaction/profile/browser/?ft_ent_identifier=7100000000000003">5</a>
        <a href="/groups/acme.users/permalink/7100000000000003/?refid=18">Full Story</a>
        <a href="/groups/acme.users/permalink/7100000000000003/#comments">3 Comments</a>
        <a href="/groups/acme.users/permalink/7100000000000003/#reply">Comment</a>
      </footer>
    </article>
    <article data-ft='{"top_level_post_id":"7100000000000004"}'>
      <header><h3><a href="/profile.php?id=100600&amp;refid=18">Kim Ito</a></h3></header>
      <div><span><p>Weekly thread</p></span></div>
      <footer><abbr>Yesterday at 9:02 PM</abbr><a href="/story.php?story_fbid=7100000000000004&amp;id=1234567890">Full Story</a></footer>
    </article>
  </div>`;

const THREAD = `${CHROME}
  <div role="main">
    <div data-ad-preview="message"><div dir="auto">Has anyone tried Acme for team billing?</div></div>
    <div><span>4 comments</span></div>
    <div role="article" aria-label="Comment by Bo Chen 2 hours ago">
      <a href="https://www.facebook.com/groups/1234567890/user/100300/"><span>Bo Chen</span></a>
      <div dir="auto">We moved off <a href="https://www.facebook.com/acmeapp">Acme</a> last month</div>
      <a href="https://www.facebook.com/groups/1234567890/posts/7100000000000001/?comment_id=9200000000000001&amp;__cft__[0]=AZ">2h</a>
      <div role="button"><span>View 3 replies</span></div>
      <div role="article" aria-label="Reply by Lee Park 1 hour ago">
        <a href="https://www.facebook.com/groups/1234567890/user/100400/">Lee Park</a>
        <div dir="auto">same here</div>
        <a href="https://www.facebook.com/groups/1234567890/posts/7100000000000001/?comment_id=9200000000000001&amp;reply_comment_id=9300000000000001">1h</a>
      </div>
    </div>
    <div role="article" aria-label="Comment by Kim Ito 5 minutes ago">
      <a href="https://www.facebook.com/groups/1234567890/user/100600/">Kim Ito</a>
      <div dir="auto"><a href="https://www.facebook.com/profile.php?id=100001">Dana Reyes</a> can you check this?</div>
      <a href="https://www.facebook.com/groups/1234567890/posts/7100000000000001/?comment_id=Y29tbWVudDo3MTAwMDAwMDAwMDAwMDAxXzkyMDAwMDAwMDAwMDAwMDI%3D">5m</a>
    </div>
  </div>`;

describe("every script", () => {
  it.each(Object.entries(allScripts()))("%s is a single valid expression", (_name, script) => {
    expect(() => new Function(`return ${script};`)).not.toThrow();
  });
});

describe("groupFeedScript", () => {
  it("reads each post's id, author, text, time, tags and counts, outside its comment preview", async () => {
    page(GROUP_URL, WWW_FEED);
    const snapshot = await runAsync<FeedSnapshot>(groupFeedScript());
    expect(snapshot).toMatchObject({ feed: true, group_name: "Acme Users" });
    expect(snapshot.gate).toEqual({ login_wall: false, checkpoint: false, blocked: "", unavailable: false, not_member: false });
    expect(snapshot.posts).toHaveLength(2);
    const [first, second] = snapshot.posts;
    expect(first).toEqual({
      id: "7100000000000001",
      url: "https://www.facebook.com/groups/1234567890/posts/7100000000000001/?__cft__[0]=AZ",
      group: "1234567890",
      author: "Mila Novak",
      author_id: "100200",
      author_url: "https://www.facebook.com/profile.php?id=100200",
      text: "Is Acme down for anyone else? Dana Reyes any idea?\nCan't log in since noon 😩",
      truncated: true,
      time_text: "3h",
      mentions: [{ name: "Dana Reyes", id: "100001", url: "https://www.facebook.com/profile.php?id=100001" }],
      comments_text: "23 comments",
      reactions_text: "1.2K",
      shares_text: "4 shares",
      action_bar: true,
      alt_id: "",
    });
    expect(second).toMatchObject({
      id: "7100000000000002",
      group: "acme.users",
      author: "Lee Park",
      author_id: "100400",
      text: "Looking for an alternative to Acme, any suggestions?",
      truncated: false,
      time_text: "Yesterday at 10:15",
      comments_text: "",
      reactions_text: "You and 12 others",
      action_bar: true,
    });
  });

  it("keys a post by its numeric id when the page links it beside a pfbid one, and keeps the pfbid as an alias", async () => {
    page(GROUP_URL, `${CHROME}<div role="main"><div role="feed">
      <div role="article">
        <h3><a href="https://www.facebook.com/profile.php?id=100400">Lee Park</a></h3>
        <a href="https://www.facebook.com/groups/acme.users/posts/pfbid02AbCdEfGhIjKlMnOp/?__cft__[0]=AZ" aria-label="2h">2h</a>
        <div data-ad-preview="message"><div dir="auto">acme by link</div></div>
        <a href="https://www.facebook.com/groups/acme.users/?multi_permalinks=7199999999999999">See post</a>
      </div>
      <div role="article">
        <h3><a href="https://www.facebook.com/profile.php?id=100500">Ana Lima</a></h3>
        <a href="https://www.facebook.com/groups/acme.users/posts/pfbid02ZyXwVuTsRqPoNmLk/" aria-label="5m">5m</a>
        <div data-ad-preview="message"><div dir="auto">only a pfbid</div></div>
      </div>
    </div></div>`);
    const [both, only] = (await runAsync<FeedSnapshot>(groupFeedScript())).posts;
    expect(both).toMatchObject({ id: "7199999999999999", alt_id: "pfbid02AbCdEfGhIjKlMnOp", time_text: "2h", group: "acme.users" });
    expect(only).toMatchObject({ id: "pfbid02ZyXwVuTsRqPoNmLk", alt_id: "", time_text: "5m" });
  });

  it("reads nothing, and says why, on a page with no feed", async () => {
    page(GROUP_URL, `${CHROME}<div role="main"><span>Loading…</span></div>`);
    const snapshot = await runAsync<FeedSnapshot>(groupFeedScript());
    expect(snapshot).toMatchObject({ feed: false, posts: [] });
    expect(snapshot.diag?.feeds).toBe(0);
  });
});

describe("mobileGroupScript", () => {
  it("reads the server-drawn m.facebook.com group page", () => {
    page("https://m.facebook.com/groups/acme.users/", MOBILE_FEED);
    const snapshot = run<FeedSnapshot>(mobileGroupScript());
    expect(snapshot.group_name).toBe("Acme Users");
    expect(snapshot.posts).toEqual([
      {
        id: "7100000000000003",
        url: "https://m.facebook.com/groups/acme.users/permalink/7100000000000003/?refid=18",
        group: "acme.users",
        author: "Ana Lima",
        author_id: "100500",
        author_url: "https://www.facebook.com/profile.php?id=100500",
        text: "acme API limits? We hit 429s at 10 rps.",
        truncated: false,
        time_text: "2 hrs",
        mentions: [],
        comments_text: "3 Comments",
        reactions_text: "5",
        shares_text: "",
        action_bar: true,
        alt_id: "",
      },
      expect.objectContaining({ id: "7100000000000004", group: "1234567890", author: "Kim Ito", author_id: "100600", text: "Weekly thread", time_text: "Yesterday at 9:02 PM" }),
    ]);
  });
});

describe("threadScript", () => {
  it("reads the top-level comments with their ids, authors, tags and replies, and leaves replies out", () => {
    page("https://www.facebook.com/groups/acme.users/posts/7100000000000001/", THREAD);
    const snapshot = run<ThreadSnapshot>(threadScript());
    expect(snapshot.comments_text).toBe("4 comments");
    expect(snapshot.comments).toEqual([
      {
        id: "9200000000000001",
        author: "Bo Chen",
        author_id: "100300",
        author_url: "https://www.facebook.com/profile.php?id=100300",
        text: "We moved off Acme last month",
        time_text: "2h",
        mentions: [{ name: "Acme", id: "", url: "https://www.facebook.com/acmeapp" }],
        replies_text: "View 3 replies",
      },
      {
        id: "9200000000000002",
        author: "Kim Ito",
        author_id: "100600",
        author_url: "https://www.facebook.com/profile.php?id=100600",
        text: "Dana Reyes can you check this?",
        time_text: "5m",
        mentions: [{ name: "Dana Reyes", id: "100001", url: "https://www.facebook.com/profile.php?id=100001" }],
        replies_text: "",
      },
    ]);
  });
});

// As captured live on 2026-10-09: a post is a plain child of the feed (the
// articles left there are empty placeholders), its time link carries only
// "?__cft__…" until the pointer is over it, and a hidden notifications panel
// draws an h1 before the group's own.
const OCT_2026_FEED = `
  <div role="complementary"><h1>Notifications</h1></div>
  <div role="feed">
    <div><div role="article"></div></div>
    <div class="post">
      <h3><a href="/groups/536969943378658/user/679764754/?__cft__[0]=x">Wojciech Zeglin</a></h3>
      <a class="time" href="?__cft__[0]=AZgub" role="link">s͏o͏p͏</a>
      <div data-ad-preview="message"><div dir="auto">Anyone know a proxy that works for scraping?</div></div>
    </div>
    <div class="photo-post">
      <h3><a href="/groups/536969943378658/user/100002/">Ana Lima</a></h3>
      <a href="https://www.facebook.com/photo/?fbid=101&amp;set=gm.2446779445731099&amp;idorvanity=536969943378658">photo</a>
      <div data-ad-preview="message"><div dir="auto">Our scraping setup</div></div>
    </div>
  </div>`;

describe("groupFeedScript on the October 2026 front end", () => {
  it("reads feed children, points at the hidden time link for its address, and takes a photo post's id from set=gm.", async () => {
    page("https://www.facebook.com/groups/dataminers/?sorting_setting=CHRONOLOGICAL", OCT_2026_FEED);
    document.title = "(1) Web Scraping World | Facebook";
    // Facebook writes the address when the pointer is over the link.
    const time = document.querySelector("a.time")!;
    time.addEventListener("mouseover", () => time.setAttribute("href", "https://www.facebook.com/groups/dataminers/posts/2446779445731022/?__cft__[0]=AZgub"));
    const snapshot = await runAsync<FeedSnapshot>(groupFeedScript());
    expect(snapshot.group_name).toBe("Web Scraping World");
    expect(snapshot.posts.map((post) => [post.id, post.author, post.text])).toEqual([
      ["2446779445731022", "Wojciech Zeglin", "Anyone know a proxy that works for scraping?"],
      ["2446779445731099", "Ana Lima", "Our scraping setup"],
    ]);
    expect(snapshot.posts[1]!.url).toBe("https://www.facebook.com/groups/dataminers/posts/2446779445731099/");
  });
});

describe("identityScript", () => {
  it("drops the \"'s profile\" a profile link's label adds to the name", () => {
    page(GROUP_URL, `<a aria-label="Dana Reyes's profile" href="/groups/acme.users/user/100001/">x</a>`);
    document.cookie = "c_user=100001";
    expect(run<IdentitySnapshot>(identityScript())).toMatchObject({ id: "100001", name: "Dana Reyes" });
  });

  it("takes the id from the session cookie and the name from a link to that id", () => {
    page(GROUP_URL, WWW_FEED);
    document.cookie = "c_user=100001";
    expect(run<IdentitySnapshot>(identityScript())).toMatchObject({ id: "100001", name: "Dana Reyes", chrome: true });
  });

  it("falls back to the account button's label, and reports no session signed out", () => {
    page("https://www.facebook.com/", CHROME);
    document.cookie = "c_user=100001";
    expect(run<IdentitySnapshot>(identityScript())).toMatchObject({ id: "100001", name: "Dana Reyes" });
    document.cookie = "c_user=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    page("https://www.facebook.com/login/", `<form action="/login/device-based/regular/login/"><input name="email"><input name="pass" type="password"></form>`);
    expect(run<IdentitySnapshot>(identityScript())).toMatchObject({ id: "", name: "", chrome: false, gate: { login_wall: true } });
  });
});

describe("the screens in front of a group", () => {
  const health = () => run<PageHealth>(pageHealthScript());

  it("calls a drawn group page rendered, About card and all", () => {
    page(GROUP_URL, WWW_FEED);
    expect(health()).toMatchObject({ host: "www", rendered: true, feed: true, gate: { not_member: false } });
    expect(health().articles).toBeGreaterThan(0);
  });

  it("knows the sign-in wall, and the sign-in dialog over a public group", () => {
    page("https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Fgroups%2Facme.users%2F", `<form action="/login/"><input name="email"><input name="pass" type="password"></form>`);
    expect(health().gate.login_wall).toBe(true);
    page(GROUP_URL, `${WWW_FEED}<div role="dialog"><input name="email"><input name="pass" type="password"></div>`);
    expect(health()).toMatchObject({ rendered: true, gate: { login_wall: true } });
  });

  it("knows a security check", () => {
    page("https://www.facebook.com/checkpoint/1501092823525282/?next=https%3A%2F%2Fwww.facebook.com%2F", `<form action="/checkpoint/"><input name="email"><input name="pass"></form><h2>Confirm your identity</h2>`);
    expect(health().gate).toMatchObject({ checkpoint: true, login_wall: false });
  });

  it("knows a block, in either apostrophe", () => {
    page(GROUP_URL, `<div role="dialog"><h2>You’re Temporarily Blocked</h2><span>It looks like you were misusing this feature by going too fast.</span></div>`);
    expect(health().gate.blocked).toBe("You’re Temporarily Blocked");
    page(GROUP_URL, `${WWW_FEED}<div role="dialog"><span>You can't use this feature right now</span></div>`);
    expect(health().gate.blocked).toBe("You can't use this feature right now");
  });

  it("does not take a post or a comment that quotes a block notice for the block", async () => {
    page(GROUP_URL, `${CHROME}<div role="main"><div role="feed">
      <div role="article"><h3><a href="https://www.facebook.com/profile.php?id=100400">Lee Park</a></h3>
        <a href="https://www.facebook.com/groups/acme.users/posts/7100000000000009/">1h</a>
        <div data-ad-preview="message"><div dir="auto">Anyone else getting "You're temporarily blocked" when posting?</div></div>
        <div role="article" aria-label="Comment by Bo Chen"><div dir="auto">yes, you can't use this feature right now for a day</div></div>
      </div>
      <div aria-posinset="2"><div dir="auto">Your account has been restricted, they told me</div></div>
    </div></div>`);
    expect(health().gate.blocked).toBe("");
    expect((await runAsync<FeedSnapshot>(groupFeedScript())).gate.blocked).toBe("");
    page("https://www.facebook.com/groups/acme.users/posts/7100000000000009/", `${CHROME}<div role="main">
      <div data-ad-comet-preview="message"><div dir="auto">FYI: "You're Temporarily Blocked" means wait a day</div></div></div>`);
    expect(run<ThreadSnapshot>(threadScript()).gate.blocked).toBe("");
    // The notice itself, drawn over the feed, still counts.
    page(GROUP_URL, `${WWW_FEED}<div role="dialog"><h2>You’re Temporarily Blocked</h2></div>`);
    expect(health().gate.blocked).toBe("You’re Temporarily Blocked");
  });

  it("knows a private group the account has not joined", () => {
    page("https://www.facebook.com/groups/private.club/?sorting_setting=CHRONOLOGICAL", `${CHROME}
      <div role="main"><h1>Private Club</h1><span>Private group · 1.2K members</span><div role="button">Join group</div>
      <span>Only members can see who's in the group and what they post.</span></div>`);
    expect(health()).toMatchObject({ rendered: false, gate: { not_member: true, unavailable: false } });
  });

  it("knows a group that is not there", () => {
    page("https://www.facebook.com/groups/no.such.group/?sorting_setting=CHRONOLOGICAL", `${CHROME}
      <div role="main"><h2>This content isn't available right now</h2><span>When this happens, it's usually because the owner only shared it with a small group of people.</span></div>`);
    expect(health()).toMatchObject({ rendered: false, gate: { unavailable: true, not_member: false } });
  });

  it("ends a wait on a gate as well as on a post", () => {
    page(GROUP_URL, `${CHROME}<div role="main"></div>`);
    expect(run<{ found: boolean }>(existsScript(FEED_READY_SELECTOR)).found).toBe(false);
    page("https://www.facebook.com/checkpoint/1/", "<div></div>");
    expect(run<{ found: boolean }>(existsScript(FEED_READY_SELECTOR)).found).toBe(true);
    page(GROUP_URL, WWW_FEED);
    expect(run<{ found: boolean }>(existsScript(FEED_READY_SELECTOR)).found).toBe(true);
  });
});
