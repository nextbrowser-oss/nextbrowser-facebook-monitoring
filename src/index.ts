// @nextbrowser-oss/facebook-monitoring — the browser-agnostic core.
//
// Nothing exported from here touches Node: the Nextbrowser app runs it in the
// renderer with its own nextctl-backed browser. The Node adapter (nbc CLI,
// state file, command line) is "@nextbrowser-oss/facebook-monitoring/node".

export type { MonitorBrowser } from "./browser.js";
export {
  checkAccount,
  runPass,
  type AccountCheck,
  type PassDeps,
  type PassResult,
  type PassSummary,
} from "./engine.js";
export type {
  AccountChangedEvent,
  ItemSource,
  Match,
  MonitorEvent,
  NewItemEvent,
  SecurityCheckEvent,
  SignedInEvent,
  SignedOutEvent,
} from "./events.js";
export {
  defaultSettings,
  emptyState,
  normalizeSettings,
  normalizeState,
  withSettings,
  MAX_GROUPS,
  type AccountState,
  type MonitorSettings,
  type MonitorState,
  type PassRecord,
  type PostWatch,
  type SourceState,
} from "./state.js";
export {
  commentItem,
  groupContext,
  normalizePosts,
  postItem,
  type Addressed,
  type FacebookItem,
  type GroupContext,
  type GroupPost,
  type ItemKind,
  type PostContext,
} from "./items.js";
export { keywordMatcher, normalizeKeyword, normalizeKeywords, splitKeywords, MAX_KEYWORDS } from "./keywords.js";
export { byUrgency, triage, DEFAULT_URGENT_TERMS, type Triage, type Urgency } from "./triage.js";
export { commentUrl, feedUrl, groupUrl, mobileFeedUrl, normalizeGroup, postIdFromUrl, postUrl } from "./ids.js";
export { drawnTimeRange, type TimeRange } from "./times.js";
export { parseCount, reactionCount } from "./counts.js";
export { SIGN_IN_URL } from "./scripts.js";
export type { LogEntry, LogSink } from "./log.js";
export { scheduleDelay, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS } from "./schedule.js";
