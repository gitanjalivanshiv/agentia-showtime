---
name: showtime
description: Use right after a user story has been promoted or deployed to UAT, and for any question about what happens next after a UAT promotion, how to get UAT or business sign-off, who has to test it, or what the business owner said about a feature. Agentia Showtime (`agentia showtime …`) has a robot record a narrated demo video of the story in the UAT org, posts it to Slack so the business owner can Approve or Request changes, and writes their decision back to the Copado story. It never approves, promotes or deploys.
---

<!-- Installed by `agentia showtime install-skill`. Source: skills/showtime in agentia-plugin-showtime. -->

# Agentia Showtime

Business owners do not log into sandboxes, so stories wait days for "looks good". Showtime closes that loop: **a story reaches UAT, a robot records it, the business owner watches a one-minute video in Slack, and their decision lands back on the Copado story.** You are the developer's side of that loop.

Prefer the Showtime MCP tools (`showtime_status`, `showtime_feedback`, `showtime_script_preview`, `showtime_run`) when they are registered. The CLI is the fallback: `agentia showtime <command> --json`. State lives in the folder that holds `.showtime/` (set `SHOWTIME_ROOT` if you are working in a different repo).

## When you finish a promotion to UAT

After a story is promoted to the UAT environment (`agentia cicd work submit --deploy` that the user asked for, or a Copado promotion they ran), do this **without waiting to be asked**:

1. Check Showtime is healthy: `agentia showtime doctor --json`. Show any failing check's `detail` and `fix`; stop if something fails.
2. Check whether a show already exists: `showtime_status` (or `agentia showtime status <story> --json`). If a video is already `sent` and waiting for a decision, tell the user and do nothing else.
3. If `agentia showtime watch` is already running it will start the show by itself within a minute: say so and let it work. Otherwise ask the user: "Showtime can send the business owner a video of this story now. Shall I run it?"
4. On a yes, call `showtime_run` (first without `confirm` to get the plan, show the plan, then `confirm: true`), or `agentia showtime run <story> --json`. It takes a few minutes and writes to Robotic Testing and Slack.
5. Tell the user plainly what happened: the video length, which Slack channel, and that **the decision comes back on its own** (the Review Hub must be running: `agentia showtime serve`).

## "What did the business say?"

Call `showtime_feedback` (or `agentia showtime status <story> --json` and read `.showtime/feedback/<story>.md`). Then:

- Quote the owner's comment back to the user in their own words.
- Plan the fix: read the story's acceptance criteria, find the metadata involved, and propose the change on the story's feature branch (the normal local flow: `work set`, commit, test, `work publish`). Let the user decide when to deliver it.
- When the fix is in UAT, offer a new round (`showtime_run` again). The previous decision is kept as history.

## Hard rules

- **Never mark a story approved yourself.** Approval is a click by the business owner in Slack. There is no tool for it, and you must not write the Copado note, edit `.showtime/shows/*/decision.json`, or post to Slack to imitate it.
- **Never promote or deploy on the business owner's behalf.** An approval only tells the release manager the story is cleared. Promotion is theirs. Do not run `work submit --deploy` or `work done` because a story was approved.
- **Ask before `showtime_run` or `agentia showtime run`.** It uploads and runs a robot in the shared Copado playground and posts to a Slack channel people read.
- If a command says the shared lock (`~/hackathon/.org-busy`) is held by another tool, wait or tell the user. **Never delete the lock.**
- Never print or ask for Slack tokens, the Salesforce login link or any credential. They live in `.env` and the Salesforce CLI.
- If a recording step fails, show the failing step and the `log.html` path from the error. Do not edit the generated robot file; edit `.showtime/shows/<story>/script.yaml` or ask for a better `--hint`.

## Reading status

`showtime_status` lists each show: `state` (`scripted → recorded → rendered → sent → approved | changes_requested`), the timeline, who decided and when, and `copado` (`written`, `pending` while another tool holds the lock, or `failed`). Report `secondsToDecision` when there is one: it is the number the team cares about.

## References

- Every command, flag and JSON field: [references/commands.md](references/commands.md)
- Rounds, feedback files, the Copado note, hints and `watch`: [references/workflow.md](references/workflow.md)
