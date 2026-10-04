# Contributing to Nextbrowser Facebook Monitoring

Thank you for helping improve the Facebook Groups monitoring engine behind Nextbrowser. Contributions of all sizes are welcome: bug reports, fixes to how facebook.com is read, better triage rules, tests, documentation, and new features.

Please keep contributions focused, factual, and easy to review. By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- Search existing issues and pull requests to avoid duplicate work.
- For a small fix, a documentation correction, or a test improvement, open a pull request directly.
- For a new kind of event, a new thing to read, a new triage rule, or a new dependency, open an issue first so the approach can be discussed.
- Do not report security vulnerabilities publicly. Follow [SECURITY.md](SECURITY.md).

## Development setup

You need Git and Node.js 22 or later. A live check additionally needs [Nextbrowser](https://github.com/nextbrowser-oss/nextbrowser-app) and a profile signed in to facebook.com as a member of a group you are allowed to monitor.

```bash
git clone https://github.com/YOUR-USERNAME/nextbrowser-facebook-monitoring.git
cd nextbrowser-facebook-monitoring
git remote add upstream https://github.com/nextbrowser-oss/nextbrowser-facebook-monitoring.git
npm ci
npm test
```

## Repository structure

| Path | What lives there |
| --- | --- |
| `src/engine.ts` | The pass: groups, scrolling, the fallback, freshness, comments, parking the tab. |
| `src/page.ts` | Loading one page and waiting, bounded, until Facebook has drawn it. |
| `src/scripts.ts` | The page scripts evaluated on facebook.com and m.facebook.com. Each one is a single JSON-returning expression. |
| `src/keywords.ts`, `src/triage.ts`, `src/items.ts`, `src/times.ts`, `src/counts.ts`, `src/ids.ts` | Pure rules: what matches, how urgent it is, how a drawn post becomes an item, what a drawn time and count mean, how links are built. |
| `src/state.ts`, `src/events.ts` | The state document, settings, and events: the public contract. |
| `src/node/` | The Node adapter: nbc browser, state file, CLI. The only code allowed to import Node. |
| `src/testing/` | The fake facebook.com used by engine tests. |
| `scripts/` | Maintenance helpers, such as the README terminal renderer. |
| `docs/` | Documentation and the README translation. |

## Ground rules for this engine

- **Read-only.** The engine must never react, comment, reply, join, post, send a message, or change a setting on facebook.com — and it never clicks, not even "See more". `src/core.test.ts` checks the scripts for the obvious ways to break this.
- **No class names.** Facebook's class names are generated and change with every release. Page scripts rely on roles, aria attributes, attributes Facebook sets for its own reasons, and link shapes. A selector on a class name will be rejected.
- **Triage stays explainable.** Every rule adds points and a reason a person can read. A rule that cannot say why it fired does not belong here, and neither does a call to a model or any other service.
- **The core stays browser-safe.** Nothing under `src/` outside `src/node/` may import a Node module or use `process`. `src/core.test.ts` fails if it does, because the app runs the core in its renderer.
- **Passes stay pure.** `runPass` never mutates the state it is given, and it never sleeps longer than the pause before a page. Timers and storage belong to the host.
- **Pacing limits stay.** Do not lower the minimum pass interval, the pauses between pages and scrolls, or raise the caps on groups, scrolls and posts opened per pass.
- **Explain site knowledge.** A selector, a link shape, or a quirk of facebook.com gets a comment saying what Facebook draws and why the code handles it that way.

## Changing what is read from facebook.com

A change to a page script needs:

1. a trimmed document in `src/scripts.test.ts` reproducing what Facebook drew, with generated class names, personal data and anything beyond what the script needs removed;
2. a test that fails without the change;
3. the page it was observed on and the date, in the pull request.

Where possible, run the changed read once against a live profile and describe the result in the pull request, for example with `node dist/node/bin.js once --profile <name> --verbose`. Never commit captured pages that contain other people's names, posts or profile links.

## Changing the triage

A new rule, or a new weight, needs a case in `src/rules.test.ts` for an item it should rank differently and one it should leave alone, and an update to the table in [how it works](docs/how-it-works.md#triage).

## Required checks

```bash
npm run typecheck
npm test
npm run build
```

If a check cannot be run on your platform, say so in the pull request. Do not claim a check passed if it was skipped.

The terminal image in the README is generated from the CLI's own formatters. After changing CLI output, regenerate it:

```bash
npm run build && npm run render:terminal
```

## Documentation and translations

`README.md` is the canonical English README. A semantic change to it must also update [`docs/i18n/ru/README.md`](docs/i18n/ru/README.md). Keep commands, paths, and product names identical, and check relative links from each file's location.

Do not add unverified features, platform support, metrics, or screenshots.

## Commits and pull requests

Use Conventional Commit prefixes in the imperative mood:

```text
fix: read a post's author from the h4 header Facebook draws in groups
feat: rank a post that links to the brand's domain
docs: explain why drawn times are read as ranges
```

A pull request should include the problem and the chosen solution, links to related issues, the checks you ran and their results, and any risks or follow-up work. Keep it free of generated `dist/` output, credentials, cookies, and personal data from facebook.com.

Thank you for making Nextbrowser better.
