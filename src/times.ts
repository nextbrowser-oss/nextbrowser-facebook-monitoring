// Reading the time Facebook draws beside a post or a comment.
//
// Facebook never draws a timestamp a script can trust. It draws a relative
// label — "Just now", "5m", "3h", "2 hrs", "Yesterday at 10:15", "1d", "2w" —
// often with its letters scattered across hidden spans so that text read from
// the page comes out scrambled, and for anything older a date in the viewer's
// language. So a drawn time is never what decides whether a post is new: the
// post's id and its place in the chronological feed decide that (see
// engine.ts). A time is only a bound, used to keep resurfaced old posts out
// and, where it is precise enough, to date a post the feed position cannot.
//
// Every label read here becomes a range, never a point: "3h" means at least
// three hours and less than four, so the post was created between four and
// three hours before the page was read. "Yesterday" is taken as anywhere in
// the last 48 hours, because the browser profile's time zone — which is what
// Facebook draws in — is often the proxy's, not the machine's. Anything else,
// a date included, returns undefined.

export interface TimeRange {
  /** The earliest the item can have been created, ms since the epoch. */
  earliest: number;
  /** The latest the item can have been created. */
  latest: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const UNITS: [RegExp, number][] = [
  [/^(?:s|sec|secs|second|seconds)$/, 1000],
  [/^(?:m|min|mins|minute|minutes)$/, MINUTE],
  [/^(?:h|hr|hrs|hour|hours)$/, HOUR],
  [/^(?:d|day|days)$/, DAY],
  [/^(?:w|wk|wks|week|weeks)$/, 7 * DAY],
  [/^(?:y|yr|yrs|year|years)$/, 365 * DAY],
];

/** drawnTimeRange reads a drawn label against the time the page was read. */
export function drawnTimeRange(label: string | null | undefined, readAt: number): TimeRange | undefined {
  const text = String(label ?? "")
    .toLowerCase()
    .replace(/[·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+ago$/, "")
    .replace(/^about\s+/, "");
  if (!text) return undefined;
  if (/^(just now|now)$/.test(text)) return { earliest: readAt - MINUTE, latest: readAt };
  if (/^yesterday(?: at .*)?$/.test(text)) return { earliest: readAt - 2 * DAY, latest: readAt };
  const match = /^(an?|\d{1,3}) ?([a-z]+)$/.exec(text);
  if (!match) return undefined;
  const count = match[1] === "a" || match[1] === "an" ? 1 : Number(match[1]);
  const unit = UNITS.find(([pattern]) => pattern.test(match[2] ?? ""));
  if (!unit || !Number.isFinite(count)) return undefined;
  const size = unit[1];
  return { earliest: readAt - (count + 1) * size, latest: readAt - count * size };
}
