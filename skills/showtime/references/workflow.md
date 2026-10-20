# Showtime workflow

## One round

`detected → scripted → recorded → narrated → rendered → sent → approved | changes_requested`

Every transition is stored with its time in `.showtime/shows/<story>/show.json`. After `changes_requested`, a new round starts at `scripted` (or `recorded` if only the story's behaviour changed) and goes through `sent` again. Earlier decisions are kept in `.showtime/shows/<story>/history/`.

## What the business owner sees

Two Slack messages in the owners channel: the video (plays inline) and a card with **Approve**, **Request changes** (opens a comment box) and **Open in UAT**. After a click the card becomes "Approved by …" or "Changes requested by …" with the comment quoted. An approval also posts "Approved for release" to the release channel with a reminder that promotion is the release manager's job.

## Where the decision goes

1. `.showtime/shows/<story>/decision.json` (the source of truth).
2. For changes: `.showtime/feedback/<story>.md`, newest entry last. Read this when planning a fix.
3. The Copado story's **Technical Specifications** field gets a dated block; existing text is kept and the story's status is never changed:

```
[Showtime review 2026-10-09 14:32 UTC]
Decision: CHANGES REQUESTED
By: Noor
Comment: Also escalate cases for Platinum accounts.
Video: https://…
[/Showtime review]
```

If another tool holds the shared lock, the note is `pending` and the decision is still saved.

## Good demos need exact names

The AI script is only as good as the labels it is told. Give it exact record and field names with `--hint`, or put them in `.showtime/hints/<story>.txt` (or `scriptHint` in the config). Check the result with `showtime_script_preview` before a real run. Each step is one of `navigate`, `click`, `type`, `verify`, `wait`; a `verify` can check several texts with `High | VIP CUSTOMER`.

## watch

`agentia showtime watch` picks up stories whose title starts with the configured prefix (`Showtime Demo –`) and whose environment is the UAT environment. A story waiting for a decision or already approved is skipped. A story that was changed after "changes requested" starts a new round. Two failed attempts stop retries for that story; see `.showtime/shows/<story>/failure.json`.

## Safety

Showtime only writes to the Showtime CRT project, the UAT org (one demo Case per recording), one Slack workspace, and a note on the story. It holds the shared playground lock for Copado and Robotic Testing writes and never deletes another tool's lock.
