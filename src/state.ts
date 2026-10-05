// Monitor state and settings: one JSON document the caller owns and persists.
//
// A pass takes the state in and hands the next one back without mutating what
// it was given, so a pass cut short leaves the last saved state intact and
// everything a finished pass learned is in what it returned.

import { groupKey, normalizeGroup, normalizePostId } from "./ids.js";
import { MAX_KEYWORDS, normalizeKeywords } from "./keywords.js";
import { DEFAULT_URGENT_TERMS } from "./triage.js";

export interface MonitorSettings {
  /** Groups to watch: ids, vanity names or links. The account must be a
   *  member of a private group to read it. */
  groups: string[];
  /** Words and phrases to find: a brand, a product, a competitor. */
  keywords: string[];
  /** Words that drop an item even when a keyword matched. */
  excludeKeywords: string[];
  /** Terms that make an item urgent; see triage.ts. */
  urgentTerms: string[];
  /** Report every new post in the watched groups, not only those that name a
   *  keyword or mention the account. */
  reportAllPosts: boolean;
  /** Open posts whose comment count grew and read their comments: posts that
   *  name a keyword or mention the account, and the account's own posts. */
  watchComments: boolean;
  /** How many times a group's feed may be scrolled to get back to posts the
   *  last pass saw. */
  maxScrolls: number;
  /** How many posts one pass may open to read their comments. A post past
   *  this is opened on the next pass instead. */
  maxCommentReads: number;
  /** How old an item may be and still be announced. 0 turns the limit off. */
  maxItemAgeMs: number;
  /** Leave the tab on about:blank after a pass. */
  parkTab: boolean;
}

export interface AccountState {
  /** The account's numeric id. */
  id?: string;
  /** Its name as Facebook drew it. */
  name?: string;
  signedIn: boolean;
  checkedAt: number;
}

/** One watched group. */
export interface SourceState {
  /** When the group was first read: nothing created before it is announced. */
  since: number;
  /** The group's name as last drawn. */
  name?: string;
  lastReadAt?: number;
  lastNewAt?: number;
  /** Read through m.facebook.com on the last pass. */
  fallback?: boolean;
  note?: string;
}

/** What the monitor last knew about one post, to tell when its comments are
 *  worth reading: only a post whose drawn comment count grew is opened. */
export interface PostWatch {
  /** The configured group id it was found in. */
  group: string;
  /** The account wrote it. */
  own: boolean;
  /** Its comment count when it was last read, or when it was first seen. */
  comments: number;
  /** When its comments were last read. Every comment not seen by then is new
   *  on the next read. */
  threadReadAt?: number;
  /** Reads in a row whose page drew fewer new comments than the count grew
   *  by. `comments` moves only by what was read, so the post is opened again;
   *  after three such reads the count is taken as read. */
  shortReads?: number;
  checkedAt: number;
}

export interface PassRecord {
  at: number;
  finishedAt: number;
  newItems: number;
  urgent: number;
  notes: string[];
}

export interface MonitorState {
  version: 1;
  settings: MonitorSettings;
  account?: AccountState;
  /** Keyed by "group:<id>", the id lowercased. */
  sources: Record<string, SourceState>;
  /** Item keys already seen, newest last, bounded, across every group:
   *  "post:<id>", "comment:<id>". */
  seen: string[];
  /** Keyed by post id. */
  posts: Record<string, PostWatch>;
  lastPass?: PassRecord;
}

export const MAX_GROUPS = 10;
export const MAX_URGENT_TERMS = 50;
export const DEFAULT_MAX_SCROLLS = 3;
export const MAX_SCROLLS = 6;
export const DEFAULT_MAX_COMMENT_READS = 5;
export const MAX_COMMENT_READS = 10;
export const DEFAULT_MAX_ITEM_AGE_MS = 72 * 60 * 60 * 1000;
export const MAX_SEEN = 5000;
export const MAX_POSTS_WATCHED = 300;
export const MAX_PASS_NOTES = 6;

export function defaultSettings(): MonitorSettings {
  return {
    groups: [],
    keywords: [],
    excludeKeywords: [],
    urgentTerms: [...DEFAULT_URGENT_TERMS],
    reportAllPosts: false,
    watchComments: true,
    maxScrolls: DEFAULT_MAX_SCROLLS,
    maxCommentReads: DEFAULT_MAX_COMMENT_READS,
    maxItemAgeMs: DEFAULT_MAX_ITEM_AGE_MS,
    parkTab: true,
  };
}

export function emptyState(settings: Partial<MonitorSettings> = {}): MonitorState {
  return { version: 1, settings: normalizeSettings(settings), sources: {}, seen: [], posts: {} };
}

function integer(value: unknown, fallback: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  // Number(null) and Number("") are 0, which would quietly turn the age
  // window or comment reads off: a setting left empty takes its default.
  const number = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeSettings(raw: unknown): MonitorSettings {
  const base = defaultSettings();
  const record = raw && typeof raw === "object" ? (raw as Partial<MonitorSettings>) : {};
  const groups: string[] = [];
  for (const value of Array.isArray(record.groups) ? record.groups : []) {
    const group = normalizeGroup(value);
    if (group && !groups.some((known) => known.toLowerCase() === group.toLowerCase())) groups.push(group);
  }
  return {
    groups: groups.slice(0, MAX_GROUPS),
    keywords: normalizeKeywords(record.keywords, MAX_KEYWORDS),
    excludeKeywords: normalizeKeywords(record.excludeKeywords, MAX_KEYWORDS),
    urgentTerms: Array.isArray(record.urgentTerms) ? normalizeKeywords(record.urgentTerms, MAX_URGENT_TERMS) : base.urgentTerms,
    reportAllPosts: flag(record.reportAllPosts, base.reportAllPosts),
    watchComments: flag(record.watchComments, base.watchComments),
    maxScrolls: integer(record.maxScrolls, base.maxScrolls, 0, MAX_SCROLLS),
    maxCommentReads: integer(record.maxCommentReads, base.maxCommentReads, 0, MAX_COMMENT_READS),
    maxItemAgeMs: integer(record.maxItemAgeMs, base.maxItemAgeMs, 0),
    parkTab: flag(record.parkTab, base.parkTab),
  };
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

/** normalizeState accepts whatever was on disk, including a file from an
 *  older version or a hand edit, and returns something a pass can run on. */
export function normalizeState(raw: unknown): MonitorState {
  const record = raw && typeof raw === "object" ? (raw as Partial<MonitorState>) : {};
  const state = emptyState(record.settings ?? {});

  const account = record.account;
  if (account && typeof account === "object") {
    const id = typeof account.id === "string" && /^\d{1,25}$/.test(account.id) ? account.id : undefined;
    state.account = {
      ...optional("id", id),
      ...optional("name", text(account.name)?.trim()),
      signedIn: account.signedIn === true,
      checkedAt: finite(account.checkedAt) ?? 0,
    };
  }

  for (const [key, value] of Object.entries(record.sources ?? {})) {
    if (!value || typeof value !== "object" || finite(value.since) === undefined) continue;
    const group = normalizeGroup(key.replace(/^group:/, ""));
    if (!key.startsWith("group:") || !group) continue;
    state.sources[groupKey(group)] = {
      since: value.since,
      ...optional("name", text(value.name)),
      ...optional("lastReadAt", finite(value.lastReadAt)),
      ...optional("lastNewAt", finite(value.lastNewAt)),
      ...(value.fallback === true ? { fallback: true } : {}),
      ...optional("note", text(value.note)),
    };
  }

  state.seen = Array.isArray(record.seen)
    ? record.seen.filter((key): key is string => typeof key === "string" && !!key).slice(-MAX_SEEN)
    : [];

  const posts = Object.entries(record.posts ?? {})
    .filter(([id, value]) => normalizePostId(id) && value && typeof value === "object" && finite(value.comments) !== undefined && normalizeGroup(value.group))
    .sort(([, left], [, right]) => (finite(left.checkedAt) ?? 0) - (finite(right.checkedAt) ?? 0))
    .slice(-MAX_POSTS_WATCHED);
  for (const [id, value] of posts) {
    const shortReads = Math.floor(finite(value.shortReads) ?? 0);
    state.posts[id] = {
      group: normalizeGroup(value.group),
      own: value.own === true,
      comments: value.comments,
      ...optional("threadReadAt", finite(value.threadReadAt)),
      ...optional("shortReads", shortReads > 0 ? shortReads : undefined),
      checkedAt: finite(value.checkedAt) ?? 0,
    };
  }

  const pass = record.lastPass;
  if (pass && typeof pass === "object" && finite(pass.at) !== undefined) {
    state.lastPass = {
      at: pass.at,
      finishedAt: finite(pass.finishedAt) ?? pass.at,
      newItems: finite(pass.newItems) ?? 0,
      urgent: finite(pass.urgent) ?? 0,
      notes: Array.isArray(pass.notes) ? pass.notes.filter((note): note is string => typeof note === "string").slice(-MAX_PASS_NOTES) : [],
    };
  }
  return state;
}

/** withSettings applies a settings patch, normalized. */
export function withSettings(state: MonitorState, patch: Partial<MonitorSettings>): MonitorState {
  return { ...state, settings: normalizeSettings({ ...state.settings, ...patch }) };
}
