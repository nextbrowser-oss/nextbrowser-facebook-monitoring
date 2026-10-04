# Walkthrough: from a group post to an approved reply

This walkthrough follows one group post through the four steps of the monitoring workflow — detect, triage, draft, approve — first in the Nextbrowser app, then with the standalone CLI. The account, the groups, the posts and the people are sample data; the CLI lines are what the CLI's own formatters print.

The example: **Acme** makes invoicing software. Dana Reyes runs Acme's community and is a member of two Facebook groups where Acme's customers talk: **Acme Users** (`acme.users`, a private group Acme's customers started) and **Indie SaaS Founders** (`indiesaas`, where people ask each other which tools to use). Neither group's posts can be read without signing in as a member. Dana wants to hear about every post that names Acme, every time someone mentions her, and every comment under her own posts.

## 1. Set up

**In Nextbrowser:**

1. Open **Skills → Facebook** and switch to **Monitoring**.
2. Choose the browser profile Dana uses for Facebook and press **Open facebook.com**. Sign in as Dana in the window that opens. The panel now reads `Dana Reyes · Signed in`.
3. Under **What to watch**:
   - **Groups:** `https://www.facebook.com/groups/acme.users/`, `https://www.facebook.com/groups/indiesaas/`
   - **Keywords:** `acme`, `acme billing`
   - **Skip:** `giveaway`
4. Leave **Comments** on and **Report all posts** off.
5. Leave the dial at 30 minutes and press **Start**.

**With the CLI** (same settings, saved in the state file for later runs):

```bash
node dist/node/bin.js run --profile acme \
  --groups https://www.facebook.com/groups/acme.users/,https://www.facebook.com/groups/indiesaas/ \
  --keywords "acme, acme billing" --exclude giveaway --interval 30m
```

## 2. The first pass draws the starting line

The first pass opens each group's chronological feed, reads the posts Facebook has drawn, and announces nothing: what is already there is the starting line, and a monitor that greets you with last week's posts is noise, not news. It remembers every post it read by id, and the comment count of each post that names a keyword, so from now on it opens a post only when that count grows.

```text
09:00  signed in as Dana Reyes
09:00  pass Dana Reyes: starting line: 2 groups, 5 matches
```

In the app, *Needs a look* already lists the 5 matches it found within the last 72 hours — none of them marked *New*.

## 3. Detect: a customer posts, a lead asks

Between 09:00 and 09:30:

- In **Acme Users**, Mila Novak posts: *"Is Acme down for anyone else? Can't log in since noon"*.
- In **Acme Users**, under Lee Park's older post *"Has anyone tried Acme for team billing?"*, Kim Ito tags Dana: *"Dana Reyes can you check the billing export?"*
- In **Indie SaaS Founders**, Ana Lima posts: *"Looking for an alternative to Acme for invoicing, any suggestions?"*

The 09:30 pass finds all three:

- Mila's and Ana's posts sit above the newest post the first pass saw in each group's chronological feed, so they are new — whatever time Facebook drew beside them — and both name the keyword `acme`.
- Lee's post names `acme` too, so its comment count is watched. It grew, so the pass opened the post and read its comments. Kim's comment tags Dana's profile: a mention, reported even though it names no keyword.

## 4. Triage: most urgent first, with the reasons

```text
09:30  HIGH    Mila Novak posted in Acme Users: Is Acme down for anyone else? Can't log in since noon
        [Says "can't log in" · Asks a question · No comments yet]  https://www.facebook.com/groups/acme.users/posts/1029384756/
09:30  HIGH    Kim Ito mentioned you in a comment in Acme Users: Dana Reyes can you check the billing export?
        [Mentions you · Asks a question]  https://www.facebook.com/groups/acme.users/posts/1029384701/?comment_id=1048576
09:30  MEDIUM  Ana Lima posted in Indie SaaS Founders: Looking for an alternative to Acme for invoicing, any suggestions?
        [Asks a question · Asks for a recommendation · No comments yet]  https://www.facebook.com/groups/indiesaas/posts/2047113988/
09:30  pass Dana Reyes: 2 groups: 3 new (2 urgent) of 8 matches; 1 thread read
```

Why each one landed where it did ([the rules](how-it-works.md#triage)):

| Match | Points | Level |
| --- | --- | --- |
| Mila: says "can't log in" (+3, it names the keyword), asks a question (+1), nobody has commented yet (+1) | 5 | high |
| Kim: mentions you (+4), asks a question (+1) | 5 | high |
| Ana: asks a question (+1), asks for a recommendation (+1), nobody has commented yet (+1) — a lead, not an emergency | 3 | medium |

Every line names the group and links straight to the post or the comment. In the app, every match also shows the post it belongs to — its author and its opening line — so Kim's comment can be judged without opening Facebook: it is under Lee's question about team billing.

## 5. Draft: hand a match to the reply agent

In the app, press **Draft reply** on Mila's post. The connected agent (Claude Code or Codex) receives one task, with the match's group and post: open this post in the same browser profile, read it and its comments, and write one reply that answers it in Dana's voice. It shows the draft in the chat:

> **Draft for Mila Novak** (post in Acme Users):
> "Hi Mila, thanks for flagging this. We had a sign-in issue from 11:50 that is fixed as of 12:40 — could you try again? If it still fails, send me a message with the email you sign in with and I'll look right away."
>
> Post this reply?

Nothing has been posted yet.

## 6. Approve, and only then publish

Answer **yes** and the agent posts that comment under Mila's post and reports whether Facebook showed it. Answer with changes and it redrafts. Answer **no** and nothing happens. Back in the panel, mark the match **Done** so it leaves *Needs a look*.

The engine never posts, reacts, comments or joins — it does not even press "See more". Publishing exists only in the reply agent, and only after an explicit approval.

## 7. When something goes wrong

Monitoring keeps saying what it could not do instead of going quiet. When www.facebook.com draws no feed for a group, the pass reads it once more from m.facebook.com:

```text
10:00  pass Dana Reyes: 2 groups: 0 new of 8 matches; 1 via m.facebook.com
        Indie SaaS Founders was read through m.facebook.com: www.facebook.com drew no posts.
```

A private group the account has not joined is noted, and the other groups are read as usual:

```text
10:30  pass Dana Reyes: 1 group: 0 new of 6 matches; 1 group not read
        You are not a member of Private Club: join it from this account, or remove it from the list.
```

And when Facebook pushes back, the pass stops at once:

```text
11:00  pass Dana Reyes: 1 group: 0 new of 4 matches; temporarily blocked
        Facebook is blocking this account from reading ("You're Temporarily Blocked"). The pass stopped; the next one waits three intervals.
```

The next pass waits three intervals. A security check stops the pass the same way and needs a person: open facebook.com in the profile, complete it by hand, and monitoring continues from where it stopped — nothing it saw before is announced again, and nothing that arrived in between is lost while it is inside the 72-hour window and the scroll limit. [Troubleshooting](troubleshooting.md) covers every such state.
