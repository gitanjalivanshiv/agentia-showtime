# Submission notes (Copado Agentia Headless Virtual Hackathon, deadline Oct 26, 2026)

## Pitch (three lines)
Every feature demos itself. When a story reaches UAT, Showtime has a robot walk through it, Copado AI narrate it, and sends a one-minute video to the business owner in Slack. Their Approve or Request changes lands back on the Copado story.

## One honest positioning line
Fleet Radar alerts Slack about failures and Slacktia runs the CLI from a slash command; Showtime closes the business sign-off loop with a pipeline-made video, a human decision, and that decision flowing back into Copado.

## Judging criteria
| Criterion | Where to look |
|---|---|
| Innovation | A video the pipeline made by itself plays inline in Slack; the owner decides without logging into a sandbox |
| Impact | UAT sign-off is where releases stall; measured 1 min 48 s from "in UAT" to "in Slack", approval 5 minutes later |
| Technical execution | 108 tests, deterministic video, schema-checked AI output with fallback, idempotent decisions, lock-aware write-back, CI that runs the offline demo |
| Use of Agentia extensibility | A real CLI plugin over the public `agentia` binary; Agent Skill with acceptance tests against a real agent; own MCP server whose write tool needs `confirm`; no internals |
| Presentation | README GIF, `examples/demo/sample.mp4`, `try-offline.sh` |

## Demo video storyboard (5 minutes maximum)
1. **Hook (20 s):** "Your feature is done. Now it waits four days for someone to click through UAT."
2. **Developer (30 s):** in Claude Code, the story reaches UAT; the agent (following the skill, unprompted) checks health, asks, and runs `agentia showtime run`.
3. **Behind the scenes (45 s, sped up):** script → the robot in Salesforce → narration → render. `watch` can do it with no one asking.
4. **Wow (45 s):** Slack pings; the video plays inline in the owner's message.
5. **Request changes (40 s):** "Also escalate cases for Platinum accounts." The comment lands on the story; the developer's agent reads it with `showtime_feedback` and builds the change.
6. **Approve (30 s):** round two; Approve; `#release` says "Approved for release"; Copado shows the dated note.
7. **Close (15 s):** "Copado ships it. Showtime shows it."
Honest add-on if time allows (30 s): the agent refusing to mark a story approved or promote on the owner's behalf.

## Before recording
- `examples/demo/reset.sh` to clear old demo Cases; start `agentia showtime serve`.
- Take a fresh screenshot of the Slack card for `docs/` (the current one predates the zoom fix).
- Not done and not claimed: the Agentforce stretch goal, and the end-user "What's new" announcement.

## Checklist
- [ ] Repo public, fresh clone → `examples/demo/try-offline.sh` works
- [ ] No tokens, org IDs, usernames or real data in the repo (`git grep` clean)
- [ ] Video ≤ 5 minutes, deck uploaded
