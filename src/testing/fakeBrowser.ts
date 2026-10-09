// A stand-in facebook.com for engine tests. The engine labels every evaluate
// with what it reads ("health", "identity", "feed", "mobile-feed", "thread"),
// so the fake answers by label and by the page it is on instead of running
// the scripts; the scripts themselves are tested against trimmed documents in
// scripts.test.ts.

import type { MonitorBrowser } from "../browser.js";
import type { FeedSnapshot, Gate, IdentitySnapshot, PageHealth, RawComment, RawPost, ThreadSnapshot } from "../scripts.js";

export interface FakeGroup {
  name: string;
  /** The feed, newest first; `pageSize` posts are drawn per scroll. */
  posts: RawPost[];
  /** What www.facebook.com draws for the group. */
  www?: "feed" | "blank" | "unavailable" | "not_member";
  /** What m.facebook.com draws for it. */
  mobile?: "feed" | "blank" | "unavailable";
}

const WWW_GROUP = /^https:\/\/www\.facebook\.com\/groups\/([^/]+)\/\?sorting_setting=CHRONOLOGICAL$/;
const M_GROUP = /^https:\/\/m\.facebook\.com\/groups\/([^/]+)\/$/;
const POST_PAGE = /^https:\/\/www\.facebook\.com\/groups\/([^/]+)\/posts\/([^/]+)\/$/;

export class FakeFacebook implements MonitorBrowser {
  url = "about:blank";
  signedIn = true;
  /** Every page is a /checkpoint/ page. */
  checkpoint = false;
  /** The block notice every page shows, when set. */
  blocked = "";
  /** No sign-in wall is drawn, yet there is no session cookie and no account
   *  button: a public group shown to a visitor without its login dialog. */
  anonymous = false;
  /** A read whose label this is throws, as it would in a tab that crashed. */
  failOn = "";
  id = "100001";
  name = "Dana Reyes";
  groups: Record<string, FakeGroup> = {};
  /** Comments by post id, as the post's page draws them. */
  comments: Record<string, RawComment[]> = {};
  pageSize = 4;
  scrolled = 0;
  /** The profile window sits behind others until it is brought to the front. */
  hidden = false;
  broughtToFront = 0;
  readonly opened: string[] = [];
  readonly labels: string[] = [];

  async open(url: string): Promise<void> {
    this.url = url;
    this.opened.push(url);
    this.scrolled = 0;
  }

  async waitForLoad(): Promise<void> {}

  async bringToFront(): Promise<void> {
    this.broughtToFront += 1;
    this.hidden = false;
  }

  async evaluate<T>(_script: string, label = ""): Promise<T> {
    this.labels.push(label);
    if (this.failOn && label === this.failOn) throw new Error("the tab crashed");
    return this.answer(label) as T;
  }

  /** The posts opened for their comments, by id, in order. */
  get threadsRead(): string[] {
    return this.opened.map((url) => POST_PAGE.exec(url)?.[2]).filter((id): id is string => !!id);
  }

  private where(): { kind: "www" | "m" | "post" | "other"; group?: FakeGroup; post?: string } {
    const www = WWW_GROUP.exec(this.url);
    if (www) return { kind: "www", ...(this.groups[www[1]!] ? { group: this.groups[www[1]!] } : {}) };
    const mobile = M_GROUP.exec(this.url);
    if (mobile) return { kind: "m", ...(this.groups[mobile[1]!] ? { group: this.groups[mobile[1]!] } : {}) };
    const post = POST_PAGE.exec(this.url);
    if (post) return { kind: "post", post: post[2]! };
    return { kind: "other" };
  }

  private gate(): Gate {
    const at = this.where();
    const www = at.kind === "www" ? at.group?.www ?? "feed" : "";
    const mobile = at.kind === "m" ? at.group?.mobile ?? "feed" : "";
    return {
      login_wall: !this.signedIn && !this.checkpoint,
      checkpoint: this.checkpoint,
      blocked: this.blocked,
      unavailable: ((at.kind === "www" || at.kind === "m") && !at.group) || www === "unavailable" || mobile === "unavailable",
      not_member: www === "not_member",
    };
  }

  private drawn(): RawPost[] {
    const at = this.where();
    if (!at.group) return [];
    if (at.kind === "www" && (at.group.www ?? "feed") === "feed") return at.group.posts.slice(0, this.pageSize * (this.scrolled + 1));
    if (at.kind === "m" && (at.group.mobile ?? "feed") === "feed") return at.group.posts.slice(0, this.pageSize);
    return [];
  }

  private answer(label: string): unknown {
    const gate = this.gate();
    const at = this.where();
    switch (label) {
      case "exists":
        return { found: true };
      case "health": {
        const posts = this.drawn();
        const feed = at.kind === "www" && (at.group?.www ?? "feed") === "feed";
        return {
          url: this.url,
          host: at.kind === "m" ? "m" : "www",
          rendered: feed || posts.length > 0 || at.kind === "post",
          feed,
          articles: posts.length,
          gate,
          hidden: this.hidden,
        } satisfies PageHealth;
      }
      case "identity": {
        const session = this.signedIn && !this.anonymous;
        return {
          url: this.url,
          gate,
          id: session ? this.id : "",
          name: session ? this.name : "",
          chrome: session,
        } satisfies IdentitySnapshot;
      }
      case "feed":
      case "mobile-feed":
        return { url: this.url, gate, feed: this.drawn().length > 0, group_name: at.group?.name ?? "", posts: this.drawn() } satisfies FeedSnapshot;
      case "scroll": {
        const before = this.scrolled * 600;
        const posts = at.group?.posts.length ?? 0;
        if (this.pageSize * (this.scrolled + 1) < posts) this.scrolled += 1;
        return { before, after: this.scrolled * 600, height: 10_000 };
      }
      case "thread": {
        const comments = at.post ? this.comments[at.post] ?? [] : [];
        return { url: this.url, gate, comments_text: comments.length ? `${comments.length} comments` : "", comments } satisfies ThreadSnapshot;
      }
      default:
        throw new Error(`the fake has no answer for "${label}"`);
    }
  }
}

/** NOON is when the engine tests' clock starts. */
export const NOON = Date.UTC(2026, 9, 5, 12, 0, 0);

let serial = 0;
const people = new Map<string, string>();

/** personId gives every name in the tests a stable numeric id. */
export function personId(name: string): string {
  if (!people.has(name)) people.set(name, String(100_100 + people.size));
  return people.get(name)!;
}

/** rawPost builds a post as the group page draws it, with no time a script
 *  can read unless the patch gives one: the feed position is what the engine
 *  must work with. */
export function rawPost(group: string, author: string, text: string, patch: Partial<RawPost> = {}): RawPost {
  const id = String(7_100_000_000_000_000n + BigInt(serial++));
  const authorId = personId(author);
  return {
    id,
    url: `https://www.facebook.com/groups/${group}/posts/${id}/?__cft__[0]=x`,
    group,
    author,
    author_id: authorId,
    author_url: `https://www.facebook.com/profile.php?id=${authorId}`,
    text,
    truncated: false,
    time_text: "",
    mentions: [],
    comments_text: "",
    reactions_text: "",
    shares_text: "",
    action_bar: true,
    alt_id: "",
    ...patch,
  };
}

/** rawComment builds a comment as the post's page draws it. */
export function rawComment(author: string, text: string, patch: Partial<RawComment> = {}): RawComment {
  const authorId = personId(author);
  return {
    id: String(9_200_000_000_000_000n + BigInt(serial++)),
    author,
    author_id: authorId,
    author_url: `https://www.facebook.com/profile.php?id=${authorId}`,
    text,
    time_text: "",
    mentions: [],
    replies_text: "",
    ...patch,
  };
}
