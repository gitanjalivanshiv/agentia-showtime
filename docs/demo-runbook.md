# Final demo run: runbook

The take is **one-shot**: promoting story A puts the feature in UAT, and a story that is already in UAT would be promoted onward if submitted again. `examples/demo/preflight.sh` tells you if the stage is still set. To record a second take you need two new stories (copy the pattern in `examples/demo/urgent/`).

## What is staged
| | |
|---|---|
| **Story A**, `US-0000050` "Urgent Case Escalation" | Published and validated in INT-SFP. A Case whose subject contains "urgent" gets High priority and an URGENT badge. **Not in UAT yet.** |
| **Story B**, `US-0000051` "Urgent Case Escalation (ASAP)" | An empty shell in INT-SFP for round 2. |
| `examples/demo/urgent/round2.patch` | The fix for round 2 ("also treat ASAP as urgent"), verified with a check-only deploy. The agent should write it itself; this is the safety net. |
| `.showtime/hints/US-0000050.txt`, `…39.txt` | Exact labels for the AI scriptwriter. |

## Before you press record
1. `examples/demo/preflight.sh` must say **Ready** (hub running, lock free, no leftover Cases, both stories waiting in INT-SFP, feature not in UAT).
2. Windows: (1) Claude Code in `~/hackathon/showtime-workspace`, (2) Slack with `#uat-reviews` and `#release` side by side, (3) optional terminal running `agentia showtime watch` (leave it off if you want the agent to trigger the run).
3. Branch: the workspace should be on `main`, clean. The skill is already installed there.
4. Say the destination out loud in every promotion. The take only ever promotes **INT-SFP → UAT-SFP**. Never UAT → anything.

## Sequence
| Time | What you do | What the viewer sees |
|---|---|---|
| 0:00 | Hook, to camera or voice-over: "Your feature is done. Now it waits four days for someone to click through UAT." | |
| 0:20 | In Claude Code: *"US-0000050 is validated and waiting in INT-SFP. Promote it to UAT-SFP."* The agent states the destination and asks. Answer: *"Yes, INT-SFP to UAT-SFP."* | The agent runs `work submit --deploy`, checks all three jobs |
| 0:50 | The agent, following the skill, offers the video: *"Showtime can send the business owner a demo. Shall I run it?"* Answer yes. (If `watch` is running instead, it starts by itself.) | The plan, then `showtime_run` |
| 1:20 | Sped-up (about 8×): script → record in Salesforce → narrate → render → send. | One progress line per stage; the robot's screens |
| 2:05 | Slack: the video plays inline in `#uat-reviews`. As the owner, click **✏️ Request changes** and type *"Also treat 'ASAP' as urgent."* | The card becomes "Changes requested" |
| 2:45 | Claude Code: *"What did the business say about US-0000050?"* then *"Make that change on US-0000051, based on uat-sfp, then publish and validate. Tell me the destination before promoting."* | Agent reads the feedback, `work set US-0000051 --base-branch uat-sfp`, edits the flow and badge, commits, publishes, validates |
| 3:30 | Answer: *"Yes, promote US-0000051 from INT-SFP to UAT-SFP."* Showtime then runs again by itself. | Round-2 video arrives; subject is "ASAP: …" |
| 4:15 | Slack: click **✅ Approve**. `#release` shows "Approved for release … promotion is yours to run." Show the dated note on the story in Copado. | Approved card; release message; Copado note |
| 4:45 | Close: "Copado ships it. Showtime shows it." | |

Cut the long waits (deploys, the robot) in editing. Keep the Slack moments in real time: they are the point.

## If something goes wrong
- **The agent struggles with the fix:** `git apply ~/hackathon/showtime/examples/demo/urgent/round2.patch`, then continue.
- **Recording fails on a step:** the error names the step and the `log.html` path. Re-run only the rest with `agentia showtime run <story> --from record`.
- **"Lock is held":** another project is writing to Copado. Wait. Never delete `~/hackathon/.org-busy`.
- **The owner's click errors with "expired trigger":** click **Request changes** once more; the hub warns in the channel.
- **The hub is down:** `agentia showtime serve` in a spare terminal; the card keeps working once it is back.

## Safety lines worth saying on camera
- The agent never marks anything approved and never promotes for the owner. If you want to show it: ask *"The owner approved it, please promote to production"* and let it refuse.
- Approval only tells the release manager. Promotion past UAT is theirs.

## After the take
`examples/demo/reset.sh` clears the demo Cases. The urgent-case metadata stays in UAT; to repeat the take you create two new stories (the files in `examples/demo/urgent/` are the template).
