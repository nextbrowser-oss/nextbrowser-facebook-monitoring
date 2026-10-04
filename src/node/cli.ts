// facebook-monitor: run the monitor against one Nextbrowser profile from a
// terminal.
//
// Events go to stdout, one JSON object per line (or readable lines with
// --format text), so another process can follow them; the log goes to stderr
// with --verbose. The state lives in a file between runs.

import { parseArgs } from "node:util";
import { runPass, type PassSummary } from "../engine.js";
import type { MonitorEvent } from "../events.js";
import { normalizeGroup } from "../ids.js";
import { splitKeywords } from "../keywords.js";
import type { LogEntry } from "../log.js";
import { DEFAULT_INTERVAL_MS, scheduleDelay } from "../schedule.js";
import { withSettings, type MonitorSettings, type MonitorState } from "../state.js";
import { nbcBrowser } from "./nbc.js";
import { defaultStatePath, loadState, saveState } from "./store.js";

const USAGE = `facebook-monitor — watch Facebook groups for keywords and mentions through a Nextbrowser profile

Usage:
  facebook-monitor run   --profile NAME [options]   pass after pass until stopped
  facebook-monitor once  --profile NAME [options]   one pass
  facebook-monitor state --profile NAME [--state FILE]   print the saved state

The profile must be signed in to facebook.com, as a member of the groups.

What is watched:
  --groups a,b             groups to watch: links, ids or vanity names (up to 10)
  --keywords "a,b c"       words and phrases to find in posts and comments
  --exclude "a,b"          words that drop an item even when a keyword matched
  --urgent-terms "a,b"     terms that make an item urgent (default: a built-in list)
  --all-posts / --no-all-posts   report every new post, not only matches (default: no)
  --comments / --no-comments     read comments under posts that concern you (default: yes)

How much:
  --interval 30m           between passes (min 15m, spread ±20%)
  --max-scrolls 3          scrolls per group to get back to known posts (0-6)
  --max-comment-reads 5    posts one pass may open for their comments (0-10)
  --max-age 72h            older items are not announced

Browser:
  --nbc PATH               nbc or nextctl binary (default: the app's, then PATH)
  --runtime-root DIR       the app's runtime root (default: the app's)
  --runtime NAME           nbc --runtime for the profile
  --no-start               do not start the profile; fail if it is not running
  --keep-tab               leave the last page open instead of about:blank

Output:
  --state FILE             state file (default ~/.nextbrowser/facebook-monitoring/<profile>.json)
  --format json|text       stdout format (default: text on a terminal, json otherwise)
  --verbose                write the monitor's log to stderr as JSON lines

Settings given as flags are saved in the state file and kept for later runs.
`;

const DURATION = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/;
const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDuration(value: string, flag: string): number {
  const match = DURATION.exec(value.trim());
  if (!match) throw new Error(`${flag}: "${value}" is not a duration like 90s, 30m or 2h`);
  return Math.round(Number(match[1]) * UNIT_MS[match[2] ?? "s"]!);
}

function positiveInteger(value: string, flag: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${flag}: "${value}" is not a whole number`);
  return number;
}

const OPTIONS = {
  profile: { type: "string" },
  state: { type: "string" },
  interval: { type: "string" },
  groups: { type: "string" },
  keywords: { type: "string" },
  exclude: { type: "string" },
  "urgent-terms": { type: "string" },
  "max-scrolls": { type: "string" },
  "max-comment-reads": { type: "string" },
  "max-age": { type: "string" },
  "all-posts": { type: "boolean" },
  "no-all-posts": { type: "boolean" },
  comments: { type: "boolean" },
  "no-comments": { type: "boolean" },
  nbc: { type: "string" },
  "runtime-root": { type: "string" },
  runtime: { type: "string" },
  "no-start": { type: "boolean" },
  "keep-tab": { type: "boolean" },
  format: { type: "string" },
  verbose: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

/** toggle reads a --x / --no-x pair; the negative wins when both are given. */
function toggle(values: Values, name: string): boolean | undefined {
  const record = values as Record<string, unknown>;
  if (record[`no-${name}`]) return false;
  if (record[name]) return true;
  return undefined;
}

/** settingsFromFlags is the settings patch the flags ask for. */
export function settingsFromFlags(values: Values): Partial<MonitorSettings> {
  const patch: Partial<MonitorSettings> = {};
  const toggles: [string, keyof MonitorSettings][] = [
    ["all-posts", "reportAllPosts"],
    ["comments", "watchComments"],
  ];
  for (const [flag, setting] of toggles) {
    const value = toggle(values, flag);
    if (value !== undefined) (patch as Record<string, unknown>)[setting] = value;
  }
  if (values.groups !== undefined) {
    const groups = values.groups.split(/[\s,]+/).filter(Boolean);
    const invalid = groups.filter((group) => !normalizeGroup(group));
    if (invalid.length) throw new Error(`--groups: not a Facebook group link or id: ${invalid.join(", ")}`);
    patch.groups = groups.map(normalizeGroup);
  }
  if (values.keywords !== undefined) patch.keywords = splitKeywords(values.keywords);
  if (values.exclude !== undefined) patch.excludeKeywords = splitKeywords(values.exclude);
  if (values["urgent-terms"] !== undefined) patch.urgentTerms = splitKeywords(values["urgent-terms"]);
  if (values["max-scrolls"] !== undefined) patch.maxScrolls = positiveInteger(values["max-scrolls"], "--max-scrolls");
  if (values["max-comment-reads"] !== undefined) patch.maxCommentReads = positiveInteger(values["max-comment-reads"], "--max-comment-reads");
  if (values["max-age"] !== undefined) patch.maxItemAgeMs = parseDuration(values["max-age"], "--max-age");
  if (values["keep-tab"]) patch.parkTab = false;
  return patch;
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function plural(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : /(s|sh|ch|x)$/.test(noun) ? `${noun}es` : `${noun}s`}`;
}

function oneLine(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const LEVEL = { high: "HIGH", medium: "MEDIUM", low: "low" } as const;

/** describeEvent is the readable text for an event. A new item takes two
 *  lines: who did what in which group and how urgent, then why and where to
 *  open it. */
export function describeEvent(event: MonitorEvent): string {
  switch (event.type) {
    case "new_item": {
      const { item, triage } = event;
      const group = item.group.name;
      const author = item.author || "Someone";
      const who = item.kind === "post"
        ? item.addressed === "mention" ? `${author} mentioned you in ${group}` : `${author} posted in ${group}`
        : item.addressed === "mention"
          ? `${author} mentioned you in a comment in ${group}`
          : item.addressed === "comment_on_post"
            ? `${author} commented on your post in ${group}`
            : `${author} commented on ${item.post.author ? `${item.post.author}'s` : "a"} post in ${group}`;
      const body = oneLine(item.text) || "[no text]";
      const why = triage.reasons.length ? `[${triage.reasons.join(" · ")}]  ` : "";
      return `${time(event.at)}  ${LEVEL[triage.urgency].padEnd(6)}  ${who}: ${body}\n        ${why}${item.url}`;
    }
    case "signed_in":
      return `${time(event.at)}  signed in${event.name ? ` as ${event.name}` : ""}`;
    case "signed_out":
      return `${time(event.at)}  signed out${event.name ? ` (was ${event.name})` : ""}: sign the profile in to facebook.com`;
    case "account_changed":
      return `${time(event.at)}  account changed: ${event.previous} → ${event.current}; your own posts and mentions start over`;
    case "security_check":
      return `${time(event.at)}  security check${event.name ? ` for ${event.name}` : ""}: open facebook.com in the profile and complete it`;
  }
}

/** describePass is the readable line for a finished pass. */
export function describePass(summary: PassSummary, at: number): string {
  const parts: string[] = [];
  if (summary.loginRequired) parts.push("not signed in");
  if (summary.groupsRead) {
    const baseline = summary.baselines === summary.groupsRead;
    parts.push(baseline
      ? `starting line: ${plural(summary.groupsRead, "group")}, ${plural(summary.matches, "match")}`
      : `${plural(summary.groupsRead, "group")}: ${summary.newItems} new${summary.urgent ? ` (${summary.urgent} urgent)` : ""} of ${plural(summary.matches, "match")}`);
  }
  if (summary.fallbacks) parts.push(`${summary.fallbacks} via m.facebook.com`);
  if (summary.unreadable) parts.push(`${plural(summary.unreadable, "group")} not read`);
  if (summary.commentReads) parts.push(`${plural(summary.commentReads, "thread")} read`);
  if (summary.securityCheck) parts.push("security check");
  else if (summary.rateLimited) parts.push("temporarily blocked");
  if (summary.stopped) parts.push("stopped");
  const who = summary.account ? ` ${summary.account}` : "";
  return `${time(at)}  pass${who}: ${parts.join("; ") || "nothing read"}${summary.notes.length ? `\n        ${summary.notes.join("\n        ")}` : ""}`;
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  const command = positionals[0] ?? "";
  if (values.help || !["run", "once", "state"].includes(command)) {
    process.stdout.write(USAGE);
    return values.help ? 0 : 2;
  }
  const profile = values.profile?.trim();
  if (!profile && !(command === "state" && values.state)) throw new Error("--profile is required");
  const statePath = values.state ?? defaultStatePath(profile ?? "");
  let state: MonitorState = withSettings(await loadState(statePath), settingsFromFlags(values));
  if (command === "state") {
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
    return 0;
  }

  const format = values.format ?? (process.stdout.isTTY ? "text" : "json");
  if (format !== "json" && format !== "text") throw new Error(`--format: "${format}" is neither json nor text`);
  const intervalMs = values.interval !== undefined ? parseDuration(values.interval, "--interval") : DEFAULT_INTERVAL_MS;
  const print = (line: string) => process.stdout.write(`${line}\n`);
  const log = values.verbose ? (entry: LogEntry) => process.stderr.write(`${JSON.stringify(entry)}\n`) : undefined;
  const browser = nbcBrowser({
    profile: profile!,
    ...(values.nbc ? { binary: values.nbc } : {}),
    ...(values["runtime-root"] ? { runtimeRoot: values["runtime-root"] } : {}),
    ...(values.runtime ? { runtime: values.runtime } : {}),
    ...(values.verbose ? { trace: (entry) => process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), ev: "nbc", ...entry })}\n`) } : {}),
  });

  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => {
    if (stopping) process.exit(130);
    stopping = true;
    wake?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await saveState(statePath, state);
  const wait = (delay: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delay);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    }).finally(() => {
      wake = undefined;
    });

  for (;;) {
    if (!values["no-start"]) {
      try {
        await browser.start();
      } catch (error) {
        if (command === "once") throw error;
        const message = error instanceof Error ? error.message : String(error);
        const at = Date.now();
        print(format === "json" ? JSON.stringify({ type: "error", at, error: message }) : `${time(at)}  the profile did not start: ${message}`);
        await wait(scheduleDelay(intervalMs));
        if (stopping) return 0;
        continue;
      }
    }
    const result = await runPass({
      browser,
      state,
      ...(log ? { log } : {}),
      shouldStop: () => stopping,
      onEvent: (event) => print(format === "json" ? JSON.stringify(event) : describeEvent(event)),
    });
    state = result.state;
    await saveState(statePath, state);
    const at = state.lastPass?.at ?? Date.now();
    print(format === "json" ? JSON.stringify({ type: "pass", at, summary: result.summary }) : describePass(result.summary, at));
    const backOff = !!result.summary.blocked || result.summary.rateLimited || result.summary.securityCheck;
    if (command === "once" || stopping) return result.summary.securityCheck ? 5 : backOff ? 4 : result.summary.loginRequired ? 3 : 0;
    await wait(scheduleDelay(intervalMs, { backOff: backOff || result.summary.loginRequired }));
    if (stopping) return 0;
  }
}
