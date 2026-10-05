# CLI reference

`facebook-monitor` runs the engine against one Nextbrowser profile from a terminal. It exists for developing the engine and for running it without the app. The profile must be signed in to facebook.com, as a member of the groups it watches.

```bash
npm ci && npm run build
node dist/node/bin.js <command> --profile <name> [options]
```

## Commands

| Command | What it does |
| --- | --- |
| `run` | Runs passes until stopped. Waits `--interval` between them, with a random spread. |
| `once` | Runs one pass and exits. |
| `state` | Prints the saved state as JSON. |

## What is watched

| Flag | Default | Meaning |
| --- | --- | --- |
| `--groups a,b` | none | Groups to watch, up to 10: links, numeric ids or vanity names. Replaces the saved list. |
| `--keywords "a,b c"` | none | Words and phrases, separated by commas. |
| `--exclude "a,b"` | none | Words that drop an item even when a keyword matched. |
| `--urgent-terms "a,b"` | a built-in list | Terms that make an item urgent. |
| `--all-posts` / `--no-all-posts` | off | Report every new post, not only those that name a keyword or mention the account. |
| `--comments` / `--no-comments` | on | Read comments under the account's own posts and under posts that concern it. |

## How much

| Flag | Default | Meaning |
| --- | --- | --- |
| `--interval 30m` | 30 min | Time between passes. Minimum 15 min, spread ±20%. |
| `--max-scrolls 3` | 3 | Scrolls per group to get back to posts the last pass saw (0–6). |
| `--max-comment-reads 5` | 5 | Posts one pass may open for their comments (0–10). |
| `--max-age 72h` | 72 h | Older items are not announced. |

Durations accept `ms`, `s`, `m`, `h`, and `d`; a plain number means seconds.

## Browser and output

| Flag | Default | Meaning |
| --- | --- | --- |
| `--nbc PATH` | app's `nextctl`, then `nbc` | The CLI that drives the profile. `NBC_BIN` and `NEXTCTL_BIN` also work. |
| `--runtime-root DIR` | the app's | Where the app keeps profiles and sessions. |
| `--runtime NAME` | profile's own | Passed to nbc as `--runtime`. |
| `--no-start` | starts | Do not start the profile; fail if it is not running. |
| `--keep-tab` | parks | Leave the last page open instead of `about:blank`. |
| `--state FILE` | `~/.nextbrowser/facebook-monitoring/<profile>.json` | Where the state is kept. |
| `--format text\|json` | text on a terminal | The format of stdout. |
| `--verbose` | off | The engine's log and every nbc call on stderr, as JSON lines. |

Settings given as flags are saved in the state file and apply to later runs too.

In `text` format a match takes two lines: the time, the urgency, who did what in which group and what they wrote; then, indented, the reasons and the direct link.

```text
09:30  HIGH    Kim Ito mentioned you in a comment in Acme Users: Dana Reyes can you check the billing export?
        [Mentions you · Asks a question]  https://www.facebook.com/groups/acme.users/posts/1029384701/?comment_id=1048576
```

After each pass, one line sums it up, with the notes under it:

```text
10:00  pass Dana Reyes: 2 groups: 0 new of 8 matches; 1 via m.facebook.com
        Indie SaaS Founders was read through m.facebook.com: www.facebook.com drew no posts.
```

In `json` format, stdout carries every [event](events-and-state.md#events), a `{"type":"pass","at":…,"summary":{…}}` after each pass, and `{"type":"error",…}` when the profile would not start.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Finished, or stopped with <kbd>Ctrl</kbd>+<kbd>C</kbd>. |
| `1` | An error, such as a profile that would not start under `once`, a bad flag, or a pass under `once` that an unexpected error cut short (`summary.failed`). |
| `2` | No command, or an unknown one. |
| `3` | `once` found the profile signed out. |
| `4` | `once` was blocked by Facebook. |
| `5` | `once` met a security check. |
| `130` | A second <kbd>Ctrl</kbd>+<kbd>C</kbd> while a pass was finishing. |
