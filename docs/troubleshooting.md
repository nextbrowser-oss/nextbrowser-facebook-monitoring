# Troubleshooting

Start with the log. In the app it is the monitor's log file (*Show log* in the panel); in the CLI, run with `--verbose`. Every `page` entry carries the URL asked for and the URL reached, whether Facebook drew posts, what stood in front of them (`gate`), and how long it took; a page that drew nothing also carries a `diag` with its title, how many feeds and articles it held, and the start of its text. Every `group` entry says how many posts were read, where the line of already-seen posts was (`line`, `-1` for none), and how many were new.

## "The profile is not signed in to Facebook"

The group page showed the sign-in wall: `/login`, a login form, or the email and password fields Facebook puts over a public group for a visitor. Group content is only shown to a signed-in account. Open the profile, sign in to facebook.com, and the next pass picks up from there; nothing seen before is announced again. The CLI exits with code 3 under `once`, and `run` waits three intervals before trying again.

## "Facebook stopped this account at a security check"

The page went to `/checkpoint/…`. Facebook wants a person to confirm the account — a code, a password, a photo, "this was me". Open facebook.com in the profile and complete it by hand. The monitor never tries; until it is done, every pass stops at the first page and waits three intervals before the next.

A check right after the first sign-in on a new proxy is common. Several in a row mean the account is read too often or from an address Facebook distrusts: raise the interval, lower `maxScrolls` and `maxCommentReads`, or use a steadier proxy.

## "Facebook is blocking this account from reading"

The page said "You're Temporarily Blocked", "You can't use this feature right now", "Your account is restricted", or that the account was "going too fast". The note quotes Facebook's words. The monitor stops at once and waits three intervals. If it repeats:

- raise `--interval` (60 minutes is a sound start after a block);
- lower `--max-scrolls` and `--max-comment-reads`;
- watch fewer groups;
- do not run other automation on the same account at the same time.

A restriction on the account itself ("Your account is restricted") lasts as long as Facebook says it does; there is nothing to do but wait and read it in the profile.

## "You are not a member of …"

The group is private and the account has not joined it: Facebook draws the group's About card and a Join button, and no feed. Join it from the profile (and wait for the admins to approve), or remove it from the list. The other groups are read as usual.

## "… is not available to this account"

Both www.facebook.com and m.facebook.com said "This content isn't available right now". The link may be wrong (check that it opens in the profile), the group may have been removed or renamed, or the account may have been removed or blocked from it. A group renamed to a new vanity name keeps its numeric id: use that.

## "… was read through m.facebook.com"

www.facebook.com drew no posts for the group, so the pass read it from m.facebook.com, the server-drawn mobile site. It works, but it reads one page of posts and cannot scroll. If it happens for one group once, it was a slow load; if it happens on every pass, look at the `page` and `feed_empty_read` log lines — Facebook may have changed the group page in a way the scripts do not know yet. Open an issue with those lines.

## "… could not be read this pass"

Neither site drew a post for the group. The pass goes on with the other groups and keeps this one's state; the next pass tries again. If it lasts, open the group in the profile: if posts show there, the page has changed — open an issue with the `page` and `group_unreadable` log lines (with names and texts removed).

## "The read did not get back to posts seen before"

The group had more new posts than `maxScrolls` scrolls could reach, so the read never met a post the last pass saw. Posts in between may be missed, and only posts with a readable time after the starting line are announced from that read. Raise `--max-scrolls` (up to 6), or shorten the interval within the pacing limits.

## "No keywords and reportAllPosts is off"

With no keywords, only posts and comments that mention the account and comments on its own posts are reported. Add keywords, or turn on `reportAllPosts` (`--all-posts`) to hear about every new post.

## "Signed in, but Facebook did not say as whom"

The session cookie carried no account id, and no link on the page named the account. Posts are still read, but mentions of the account and its own posts are not recognized this pass. If it lasts, check that the profile's cookies are allowed for facebook.com.

## A post I expected is missing

- It was in the group before the group's starting line: the first pass announces nothing.
- It names no keyword and does not mention the account, and `reportAllPosts` is off.
- It names an exclusion word.
- It is the account's own post: those are not announced, only the comments under them.
- It sits below the posts the last pass saw, with no readable time: a post Facebook drew out of order is not announced.
- The read did not reach it within `maxScrolls`; the summary says so.
- Its drawn time puts it before the starting line, or past `maxItemAgeMs`.
- Its text was cut behind "See more" and the keyword is in the hidden part: the monitor never expands a post.
- Facebook is set to sort the group by something else: the monitor asks for `CHRONOLOGICAL`, and a group that ignores it gives the feed position rule nothing to go on.

## A comment I expected is missing

- The post does not concern the account: only the account's own posts and posts that mention it or name a keyword have their comments read.
- The post's drawn comment count did not grow, or the pass had opened `maxCommentReads` posts already; the summary says how many wait.
- It is a reply to a comment: replies are not read.
- Facebook's "Most relevant" selection on the post's page did not draw it.
- It was the first time the post was opened, it has no readable time, and more comments were unseen than the count grew by: they cannot be told from older ones.
- It names no keyword, does not mention the account, and is not on the account's own post.

## The same post or comment shows twice

It should not: a post is keyed by its id, a comment by its id (or, without one, by its post, author and text). If it does, open an issue with both log lines.

## The profile does not start

`facebook-monitor` starts the profile through nbc, which reports why a start failed:

| nbc says | Meaning |
| --- | --- |
| `ClawBrowser does not expose managed-proxy privacy capability 2` | The browser runtime is older than nbc needs for proxied profiles. Update it from the Nextbrowser app. |
| `SESSION_NOT_FOUND` | nbc is looking in the wrong runtime root. Point `--runtime-root` at the app's (`~/.nextbrowser/runtime` on macOS). |
| `API_KEY_REQUIRED`, `API_KEY_INVALID` | The Nextbrowser account setup is incomplete. Sign in to the app. |

## Reporting a problem

Open a [bug report](https://github.com/nextbrowser-oss/nextbrowser-facebook-monitoring/issues/new/choose) with the version or commit and the relevant `--verbose` lines, with names, group names and post text removed if they are private.
