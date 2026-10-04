# Integration guide

The package has two entry points:

| Entry | Contents | Runs in |
| --- | --- | --- |
| `@nextbrowser-oss/facebook-monitoring` | `runPass`, `checkAccount`, state and settings, events, keyword matching, `triage`, links, drawn-time and count parsing, `scheduleDelay` | Anywhere. It has no Node imports; [`src/core.test.ts`](../src/core.test.ts) enforces this. |
| `@nextbrowser-oss/facebook-monitoring/node` | `nbcBrowser` (a browser over the `nbc`/`nextctl` CLI), `loadState`/`saveState`, the CLI | Node.js 22 or later |

## Installing

The package is consumed from Git. `prepare` builds `dist/` on install:

```bash
npm install github:nextbrowser-oss/nextbrowser-facebook-monitoring#<commit-or-tag>
```

Pin a commit or a tag rather than a branch, so a rebuild of the app never picks up an unreviewed change.

## The contract with Nextbrowser

The app owns everything that has a lifetime — the browser prepared for the selected profile, the timer, the storage. The engine owns only the logic of one pass.

```ts
import { normalizeState, runPass, scheduleDelay, withSettings } from "@nextbrowser-oss/facebook-monitoring";
import { cliBrowser } from "./lib/xreply/browser";

async function monitorPass(profileArgs: string[]) {
  const saved = normalizeState(await readAppData("facebook-monitor-state.json"));
  const { state, events, summary, matches } = await runPass({
    browser: cliBrowser(profileArgs),
    state: saved,
    log: (entry) => appendAppData("facebook-monitor-log.jsonl", entry),
    onStep: (step) => setStatus(step),
    onEvent: (event) => showNotification(event),
    shouldStop: () => stopRequested,
  });
  await writeAppData("facebook-monitor-state.json", state);
  showMatches(matches);
  const backOff = !!summary.blocked || summary.rateLimited || summary.securityCheck || summary.loginRequired;
  return scheduleDelay(30 * 60_000, { backOff });
}

// Settings changed in the UI: patch them, normalized. Group links, ids and
// vanity names are all accepted.
const next = withSettings(saved, {
  groups: ["https://www.facebook.com/groups/acme.users/", "indiesaas"],
  keywords: ["acme", "acme billing"],
});
```

### What to show

`result.matches` holds every item the pass found that matched, new or not, inside the `maxItemAgeMs` window, most urgent first. A first pass announces nothing but still returns what it found, so a dashboard is never empty after Start. `result.events` holds what is new; a dashboard marks those.

Each match carries everything a person needs to judge it without opening Facebook, and a panel should show all of it:

- `item.group` — the group's `id`, `name` and `url`;
- `item.post` — the post's `id`, `url`, `author` and the opening of its text (for a post, the post itself; for a comment, the post it is under);
- `item.url` — a direct link to the post or the comment;
- `item.truncated` — Facebook cut the text behind "See more"; the rest is on the page;
- `item.timeText` — the time as Facebook drew it ("3h"); `item.createdAt` is the earliest time that label allows, when it could be read;
- `triage.reasons` — what makes a *high* believable.

`summary.loginRequired`, `summary.securityCheck` and `summary.rateLimited` each need their own message in a panel: each asks the person for something different. `summary.notes` names a group that was not a member's, not available, or read through m.facebook.com; show them beside the group.

### From a match to a reply

The engine never answers. In Nextbrowser, *Draft reply* hands a match to the Facebook skill's reply agent with one task: open `item.url` in the same profile, read the post and its comments, write one reply to that post or comment, show it, and post it only after the user approves. Pass `item.url`, `item.key`, `item.author`, `item.group` and `item.post` to that flow, so the draft is written with the group and the post in view.

### Showing the account before anything runs

`checkAccount` opens facebook.com in the profile, reads who is signed in, and stops there, leaving the page open for a person who is about to sign in. It also reports a pending security check and a block.

```ts
import { checkAccount } from "@nextbrowser-oss/facebook-monitoring";

const { signedIn, name, id, securityCheck, blocked } = await checkAccount({ browser: cliBrowser(profileArgs) });
```

### The browser

`MonitorBrowser` is a subset of the app's `XBrowser` (`src/lib/xreply/browser.ts`), so the app passes its existing `cliBrowser(profileArgs)`:

```ts
interface MonitorBrowser {
  open(url: string): Promise<void>;
  evaluate<T>(script: string, label?: string): Promise<T>;
  waitForLoad(timeoutSeconds?: number): Promise<void>;
}
```

### Sharing the profile

The monitor, the reply agent, and the user's own agent runs may drive the same profile. They must take turns: run the monitor pass in the queue the app already uses for its other engine passes. A pass opens several pages one after another, so it holds the tab for a while; `shouldStop` ends it between pages.

### State

The state is one JSON document. Store it as it is, and pass whatever comes back from storage through `normalizeState`, which accepts older files, hand edits, and nothing at all. The layout is in [events and state](events-and-state.md).

### Logging

`log` receives one JSON object per step: every page with what it showed and how long it took, every group with how many posts it held, where the seen line was and how many were new, every post opened for comments, and every event. A page that drew nothing is logged with a short description of what was there (its title, how many feeds and articles, the start of its text). Append it to a rotated file; when a read fails on a user's machine, it is the full record. It holds the text of what was read, so treat it as private.

## Outside the app: the Node adapter

```ts
import { runPass, withSettings } from "@nextbrowser-oss/facebook-monitoring";
import { loadState, nbcBrowser, saveState } from "@nextbrowser-oss/facebook-monitoring/node";

const browser = nbcBrowser({ profile: "my-facebook-profile" });
await browser.start();
const path = "state.json";
const state = withSettings(await loadState(path), { groups: ["acme.users"], keywords: ["acme"] });
const result = await runPass({ browser, state });
await saveState(path, result.state);
```

`nbcBrowser` runs `nbc --profile <name> <command> … --format json` and reads nbc's `{ok, data, error}` envelope, with the app's runtime root and environment by default, so it drives the profiles the app manages. Override the runtime root with `runtimeRoot` and the binary with `binary`.
