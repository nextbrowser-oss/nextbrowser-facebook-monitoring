// What a pass reports. Events are plain JSON, so a caller can store them, send
// them over IPC, or print them one per line.

import type { FacebookItem } from "./items.js";
import type { Triage } from "./triage.js";

/** Where an item was found. */
export interface ItemSource {
  kind: "group_post" | "group_comment";
  /** The group's name, as drawn. */
  name: string;
  /** The configured group id or vanity name. */
  group: string;
}

/** An item that matched, ranked, with where it came from. It is what a
 *  new_item event carries, and what a pass hands back for a dashboard. */
export interface Match {
  item: FacebookItem;
  source: ItemSource;
  /** The keywords it names. */
  keywords: string[];
  triage: Triage;
}

/** Something new that needs a look: a group post or a comment that names a
 *  keyword or mentions the account, a comment on the account's own post, or,
 *  with reportAllPosts, any new post in a watched group. */
export interface NewItemEvent extends Match {
  type: "new_item";
  at: number;
  /** The monitored account's name. */
  account?: string;
}

/** The profile is signed in to facebook.com, for the first time or again. */
export interface SignedInEvent {
  type: "signed_in";
  at: number;
  name?: string;
  id?: string;
}

/** The profile is signed out. Group content cannot be read until someone
 *  signs it in again. */
export interface SignedOutEvent {
  type: "signed_out";
  at: number;
  name?: string;
}

/** A different account is signed in than before. Its own posts and the
 *  mentions of it start over. */
export interface AccountChangedEvent {
  type: "account_changed";
  at: number;
  previous: string;
  current: string;
}

/** Facebook stopped the session at a security check (a /checkpoint/ page)
 *  until a person completes it. */
export interface SecurityCheckEvent {
  type: "security_check";
  at: number;
  name?: string;
}

export type MonitorEvent =
  | NewItemEvent
  | SignedInEvent
  | SignedOutEvent
  | AccountChangedEvent
  | SecurityCheckEvent;
