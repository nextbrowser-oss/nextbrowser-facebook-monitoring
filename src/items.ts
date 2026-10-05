// What the monitor reports about one post or comment, with enough context to
// review it without opening Facebook: which group, which post, who wrote it,
// what they wrote, and a direct link.
//
// Everything here is pure: it turns what a page drew into posts and items.

import { commentCount, reactionCount } from "./counts.js";
import { commentUrl, groupUrl, normalizeCommentId, normalizePostId, postUrl } from "./ids.js";
import { keywordPattern } from "./keywords.js";
import type { RawComment, RawMention, RawPost } from "./scripts.js";
import { drawnTimeRange, type TimeRange } from "./times.js";

export type ItemKind = "post" | "comment";

/** How an item concerns the monitored account. */
export type Addressed = "mention" | "comment_on_post";

/** The group an item was found in. */
export interface GroupContext {
  /** The group id or vanity name, as configured. */
  id: string;
  /** Its name as the page drew it, or the id when the page drew none. */
  name: string;
  url: string;
}

/** The post an item belongs to, for context. */
export interface PostContext {
  id: string;
  url: string;
  author: string;
  /** The text's opening, cut to 200 characters. */
  text?: string;
}

export interface FacebookItem {
  /** "post:<id>" or "comment:<id>": unique across groups, so the same post
   *  read twice is one item. */
  key: string;
  id: string;
  kind: ItemKind;
  author: string;
  /** The author's numeric id, when the page linked it. */
  authorId?: string;
  authorUrl?: string;
  /** A post's or a comment's text, cut to 2,000 characters. */
  text: string;
  /** Facebook cut the text short behind "See more"; the rest is on the page. */
  truncated?: boolean;
  /** A direct link: the post, or the comment under it. */
  url: string;
  group: GroupContext;
  /** The post itself, or the post a comment is under. */
  post: PostContext;
  /** Milliseconds since the epoch: the earliest time the drawn label allows,
   *  when Facebook drew one this monitor can read. */
  createdAt?: number;
  /** The time as Facebook drew it: "3h", "Yesterday at 10:15". */
  timeText?: string;
  reactions?: number;
  /** A post's comment count, or a comment's reply count. */
  replies?: number;
  /** How it concerns the monitored account, when it does. */
  addressed?: Addressed;
}

/** A post read from a group's feed, normalized. */
export interface GroupPost {
  key: string;
  id: string;
  /** The post's other key, when the page linked it by both its numeric and
   *  its pfbid id: "post:<pfbid>". A post seen under either is the same post. */
  altKey?: string;
  url: string;
  group: GroupContext;
  author: string;
  authorId?: string;
  authorUrl?: string;
  text: string;
  truncated: boolean;
  timeText?: string;
  /** When it can have been created, from the drawn time. */
  range?: TimeRange;
  mentions: RawMention[];
  /** The drawn comment count; 0 when the action bar is drawn with no count
   *  beside it; undefined when neither could be read. */
  comments?: number;
  reactions?: number;
}

/** The monitored account, as far as the page said. */
export interface Account {
  id?: string;
  name?: string;
}

const CONTEXT_TEXT = 200;
const ID = /^\d{1,25}$/;

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined || value === "" ? {} : { [key]: value }) as { [P in K]?: V };
}

/** groupContext describes a group for the items found in it. */
export function groupContext(id: string, name?: string): GroupContext {
  return { id, name: name?.trim() || id, url: groupUrl(id) };
}

/** normalizePosts turns what a group page reported into posts, in feed order.
 *  Links are rebuilt from the configured group and the post id, so a post is
 *  linked the same way whether the page drew its permalink with the group's
 *  number or its vanity name. */
export function normalizePosts(raw: RawPost[], group: GroupContext, readAt: number): GroupPost[] {
  const posts: GroupPost[] = [];
  const keys = new Set<string>();
  for (const entry of raw ?? []) {
    const id = normalizePostId(entry?.id);
    if (!id || keys.has(id)) continue;
    keys.add(id);
    const range = drawnTimeRange(entry.time_text, readAt);
    const comments = commentCount(entry.comments_text) ?? (entry.action_bar ? 0 : undefined);
    const altId = normalizePostId(entry.alt_id);
    posts.push({
      key: `post:${id}`,
      id,
      ...optional("altKey", altId && altId !== id ? `post:${altId}` : undefined),
      url: postUrl(group.id, id),
      group,
      author: String(entry.author ?? "").trim(),
      ...optional("authorId", ID.test(String(entry.author_id ?? "")) ? String(entry.author_id) : undefined),
      ...optional("authorUrl", String(entry.author_url ?? "").trim() || undefined),
      text: String(entry.text ?? "").trim(),
      truncated: !!entry.truncated,
      ...optional("timeText", String(entry.time_text ?? "").trim() || undefined),
      ...optional("range", range),
      mentions: Array.isArray(entry.mentions) ? entry.mentions.filter((mention) => mention && mention.name) : [],
      ...optional("comments", comments),
      ...optional("reactions", reactionCount(entry.reactions_text)),
    });
  }
  return posts;
}

/** postContext describes a post for the items under it. */
export function postContext(post: GroupPost): PostContext {
  const text = post.text.replace(/\s+/g, " ").trim().slice(0, CONTEXT_TEXT);
  return { id: post.id, url: post.url, author: post.author, ...optional("text", text || undefined) };
}

/** postItem reports a post itself. */
export function postItem(post: GroupPost, addressed?: Addressed): FacebookItem {
  return {
    key: post.key,
    id: post.id,
    kind: "post",
    author: post.author,
    ...optional("authorId", post.authorId),
    ...optional("authorUrl", post.authorUrl),
    text: post.text,
    ...(post.truncated ? { truncated: true } : {}),
    url: post.url,
    group: post.group,
    post: postContext(post),
    ...optional("createdAt", post.range?.earliest),
    ...optional("timeText", post.timeText),
    ...optional("reactions", post.reactions),
    ...optional("replies", post.comments),
    ...(addressed ? { addressed } : {}),
  };
}

/** commentKey identifies a comment: by its id, and when the page drew no id,
 *  by the post, the author and the text, which is the same on every read. */
export function commentKey(raw: Pick<RawComment, "id" | "author" | "text">, postId: string): string {
  const id = normalizeCommentId(raw.id);
  return id ? `comment:${id}` : `comment:${postId}:${hash(`${raw.author}\n${raw.text}`)}`;
}

/** commentItem reports a comment under a post. */
export function commentItem(raw: RawComment, post: GroupPost, readAt: number, addressed?: Addressed): FacebookItem | undefined {
  const text = String(raw.text ?? "").trim();
  if (!text || !raw.author) return undefined;
  const id = normalizeCommentId(raw.id);
  const range = drawnTimeRange(raw.time_text, readAt);
  const replies = commentCount(String(raw.replies_text ?? "").replace(/^view (?:all )?/i, ""));
  const key = commentKey(raw, post.id);
  return {
    key,
    id: id || key.slice("comment:".length),
    kind: "comment",
    author: raw.author.trim(),
    ...optional("authorId", ID.test(String(raw.author_id ?? "")) ? String(raw.author_id) : undefined),
    ...optional("authorUrl", String(raw.author_url ?? "").trim() || undefined),
    text,
    url: id ? commentUrl(post.group.id, post.id, id) : post.url,
    group: post.group,
    post: postContext(post),
    ...optional("createdAt", range?.earliest),
    ...optional("timeText", String(raw.time_text ?? "").trim() || undefined),
    ...optional("replies", replies),
    ...(addressed ? { addressed } : {}),
  };
}

/** isOwn says whether the monitored account wrote something: by id when the
 *  page linked the author's id, by name otherwise. */
export function isOwn(author: { author: string; authorId?: string }, account: Account): boolean {
  if (account.id && author.authorId) return author.authorId === account.id;
  return !!account.name && author.author.trim().toLowerCase() === account.name.trim().toLowerCase();
}

/** mentionsAccount says whether a text mentions the account: a tag that
 *  links to its profile, a tag drawn with its name, or its full name in plain
 *  text. A first name alone is not enough: it is half the group's. */
export function mentionsAccount(text: string, mentions: RawMention[], account: Account): boolean {
  if (account.id && mentions.some((mention) => mention.id === account.id)) return true;
  const name = account.name?.trim();
  if (!name || name.length < 3) return false;
  if (mentions.some((mention) => mention.name.trim().toLowerCase() === name.toLowerCase())) return true;
  return keywordPattern(name.replace(/\s+/g, " ")).test(text);
}

/** hash is a short, stable name for a string (FNV-1a). */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(36);
}
