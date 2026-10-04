# Events and state

## Events

Every event is a plain JSON object with a `type` and an `at` (the pass time, epoch milliseconds). A pass returns its events in `result.events`; with `onEvent` it also hands each one over as it happens.

### `new_item`

Something new that needs a look: a group post or a comment that names a keyword or mentions the account, a comment on the account's own post, or, with `reportAllPosts`, any new post in a watched group.

```json
{
  "type": "new_item",
  "at": 1791192600000,
  "account": "Dana Reyes",
  "source": { "kind": "group_comment", "name": "Acme Users", "group": "acme.users" },
  "keywords": [],
  "triage": { "urgency": "high", "score": 5, "reasons": ["Mentions you", "Asks a question"] },
  "item": {
    "key": "comment:1048576",
    "id": "1048576",
    "kind": "comment",
    "author": "Kim Ito",
    "authorId": "100600",
    "authorUrl": "https://www.facebook.com/profile.php?id=100600",
    "text": "Dana Reyes can you check the billing export?",
    "url": "https://www.facebook.com/groups/acme.users/posts/1029384701/?comment_id=1048576",
    "group": { "id": "acme.users", "name": "Acme Users", "url": "https://www.facebook.com/groups/acme.users/" },
    "post": {
      "id": "1029384701",
      "url": "https://www.facebook.com/groups/acme.users/posts/1029384701/",
      "author": "Lee Park",
      "text": "Has anyone tried Acme for team billing?"
    },
    "createdAt": 1791192240000,
    "timeText": "5m",
    "addressed": "mention"
  }
}
```

| Field | Meaning |
| --- | --- |
| `account` | The signed-in account's name, when Facebook drew it. |
| `source.kind` | `group_post` or `group_comment`. `source.name` is the group's name as drawn; `source.group` its configured id or vanity name. |
| `keywords` | The keywords the item names. |
| `triage` | `urgency` (`high`, `medium`, `low`), `score`, and `reasons`, strongest first. |
| `item.key` | `post:<id>` or `comment:<id>`: the same on every read. A comment drawn without an id is keyed `comment:<post>:<hash of author and text>`. |
| `item.kind` | `post` or `comment`. |
| `item.author`, `authorId`, `authorUrl` | Who wrote it: the name as drawn, and the numeric id and profile link when the page linked them. |
| `item.text` | The text, up to 2,000 characters. `item.truncated` is `true` when Facebook cut it behind "See more". |
| `item.url` | A direct link: the post (`/groups/<group>/posts/<id>/`) or the comment (the post's link with `?comment_id=<id>`). |
| `item.group` | The group: `id` (as configured), `name` (as drawn), `url`. |
| `item.post` | The post itself, or the post a comment is under: `id`, `url`, `author`, and the opening of its text (200 characters). |
| `item.createdAt` | The earliest time the drawn label allows, when it could be read. Absent for a date, a scrambled label, or another language. |
| `item.timeText` | The time as Facebook drew it. |
| `item.reactions` | A post's reaction count, as drawn. |
| `item.replies` | A post's comment count (`0` when its action bar is drawn with no count), or a comment's reply count. |
| `item.addressed` | `mention` or `comment_on_post`, when the item concerns the account. |

### `signed_in`, `signed_out`, `account_changed`, `security_check`

```json
{ "type": "signed_in", "at": 1791190800000, "name": "Dana Reyes", "id": "100001" }
{ "type": "signed_out", "at": 1791205200000, "name": "Dana Reyes" }
{ "type": "account_changed", "at": 1791208800000, "previous": "Dana Reyes", "current": "Acme Support" }
{ "type": "security_check", "at": 1791203400000, "name": "Dana Reyes" }
```

- **`signed_in`** is emitted on the first pass, and on the first pass after a sign-out.
- **`signed_out`** is emitted once when the session ends. Nothing is read until someone signs the profile in again.
- **`account_changed`** is emitted when the session cookie names a different account than before. The previous account's own posts stop being "your posts".
- **`security_check`** is emitted on every pass Facebook holds the account at a `/checkpoint/` page; complete it in the profile.

A temporary block has no event of its own: the summary carries it (`rateLimited`, `blocked`), since it ends with time rather than with something the person does.

## The pass summary

| Field | Meaning |
| --- | --- |
| `signedIn`, `account` | Whether a signed-in session was found, and the account's name. |
| `loginRequired` | The profile is not signed in. |
| `securityCheck` | Facebook wants a security check. |
| `rateLimited` | Facebook is blocking the account from reading. |
| `blocked` | Why the pass stopped reading, when it did. Back off. |
| `pagesLoaded` | Pages opened on facebook.com. |
| `groupsRead`, `baselines` | Groups whose posts were read, and how many of them were read for the first time. |
| `fallbacks` | Groups read through m.facebook.com. |
| `unreadable` | Groups not read this pass: not a member, not available, or nothing drawn. |
| `postsRead`, `scrolls` | Posts read across the groups, and scrolls made. |
| `matches` | Items that matched inside the age window, new or not. |
| `newItems`, `urgent` | New matches, and how many are *high*. |
| `commentReads`, `commentReadsDeferred` | Posts opened for their comments, and posts whose comments grew but wait for the next pass. |
| `stopped` | `shouldStop` ended the pass early. |
| `notes` | Up to six sentences a person can read. |

## The state document

```jsonc
{
  "version": 1,
  "settings": { /* see below */ },
  "account": { "id": "100001", "name": "Dana Reyes", "signedIn": true, "checkedAt": 1791192600000 },
  "sources": {
    "group:acme.users": { "since": 1791190800000, "name": "Acme Users", "lastReadAt": 1791192600000, "lastNewAt": 1791192600000 },
    "group:indiesaas":  { "since": 1791190800000, "name": "Indie SaaS Founders", "lastReadAt": 1791192600000, "fallback": true },
    "group:private.club": { "since": 1791190800000, "note": "You are not a member of group private.club: join it from this account, or remove it from the list." }
  },
  "seen": ["post:1029384701", "post:1029384756", "comment:1048576"],   // last 5,000 item keys
  "posts": {
    "1029384701": { "group": "acme.users", "own": false, "comments": 7, "threadReadAt": 1791192600000, "checkedAt": 1791192600000 }
  },
  "lastPass": { "at": 1791192600000, "finishedAt": 1791192671000, "newItems": 3, "urgent": 2, "notes": [] }
}
```

- `sources["group:<id>"].since` is the group's starting line: nothing created before it is announced. The key is the configured id or vanity name, lowercased. `fallback` says the last read came from m.facebook.com; `note` says why the group could not be read on a later pass.
- `seen` holds every post and comment key read, matched or not: the feed position rule needs to know which posts the last pass saw.
- `posts` is what makes comment reads cheap: the comment count of each watched post when it was last read or first seen, whether the account wrote it, and when its comments were last read. Up to 300 posts; only posts that concern the account are kept.
- `account.id` is the numeric id from the session cookie; it is what tells the account's own posts and its tags.

Pass anything read from storage through `normalizeState`.

## Settings

| Setting | Default | Range and meaning |
| --- | --- | --- |
| `groups` | `[]` | Up to 10. A link (`https://www.facebook.com/groups/<id>/…`, `m.facebook.com` too), a numeric id, or a vanity name; stored as the id or vanity name. |
| `keywords` | `[]` | Up to 20 words or phrases, 2–60 characters. |
| `excludeKeywords` | `[]` | Up to 20 words that drop an item even when a keyword matched, unless it mentions the account. |
| `urgentTerms` | a built-in list | Up to 50. `[]` turns the rule off. |
| `reportAllPosts` | `false` | Report every new post in the groups. |
| `watchComments` | `true` | Read comments under the account's own posts and under posts that concern it, when their count grew. |
| `maxScrolls` | `3` | 0–6 scrolls per group. |
| `maxCommentReads` | `5` | 0–10 posts opened per pass. |
| `maxItemAgeMs` | 72 h | Older items are not announced. `0` turns the limit off. |
| `parkTab` | `true` | Leave the tab on `about:blank` after a pass. |

`scheduleDelay(intervalMs)` returns the interval with a ±20% spread, never under fifteen minutes (thirty by default), and three times as long with `backOff`.
