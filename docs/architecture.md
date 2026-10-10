# Architecture

Showtime is an Agentia CLI plugin (`agentia showtime …`). It talks to Copado only by spawning the public `agentia` binary with `--json`, behind one adapter. It never imports Agentia internals and never registers tools with `agentia mcp start`; its MCP server is its own (`agentia showtime mcp`).

```
                 ┌──────────────── agentia showtime (plugin) ─────────────────┐
 Copado story ──►│ watch → script → record → render → send                    │
 reaches UAT     │          │         │        │        │                    │
                 │   Copado AI   Robotic   ffmpeg +   Slack Web API           │
                 │               Testing   Playwright                         │
                 │                                    ▲                       │
                 │   serve (Review Hub, Socket Mode) ─┘  Approve / Changes    │
                 └──────────────────────────┬─────────────────────────────────┘
                                            ▼
                          decision.json → note on the Copado story
```

## Modules

| Path | Responsibility |
|---|---|
| `src/agentia/client.ts` | The only way to reach Copado: spawn `agentia … --json`, strip other plugins' warnings, validate with zod, typed errors that never carry request URLs or org IDs, a fake client for tests. `SHOWTIME_AGENTIA_BIN` swaps the binary. |
| `src/agentia/copado.ts` | Typed calls: auth readiness, stories, CRT projects/jobs/builds, `ai agent ask`, and the one write to a story (append a note). |
| `src/script/` | `script.yaml` schema (3–7 steps; `navigate`, `click`, `type`, `verify`, `wait`; narration of 28 words or fewer), the AI prompt, JSON extraction, one retry that tells the AI what was wrong, and the hand-written fallback. |
| `src/record/` | Generates a Robot Framework (QWeb) suite from the script, uploads it to the "Showtime Recorder" CRT job, runs it, unpacks the artifacts, and maps screenshots to steps with marker lines in `output.xml`. Logs in with a one-time link from `sf org open`. |
| `src/narrate/` | One audio clip per card. macOS `say` by default; a silent provider of the right length elsewhere; a `Tts` interface for others. Clips are cached by text. |
| `src/edit/` | HTML/CSS cards rendered to PNG by Playwright (the only thing Playwright does), then ffmpeg composites screen, caption layer and narration, concatenates, and writes a 1080p MP4 plus a 960×540 preview. Bit-exact flags, so re-renders are identical. |
| `src/review/` | Block Kit builders (pure), the Slack gateway (real and fake), `send`, the Socket Mode hub, the decision logic, and the Copado note format. |
| `src/pipeline.ts` | The four stages as functions, `runPipeline` (stops at the first failing stage), shared by `run`, `watch`, the MCP server and the single commands. |
| `src/watch.ts` | Finds stories to show, with rules for new rounds, failures and a held lock. |
| `src/mcp/` | The MCP server: four tools, none of which can approve, promote or deploy. |
| `src/store/lifecycle.ts` | The state machine and its timeline. |
| `src/lock.ts` | The shared playground lock: take it for Copado and CRT writes, release it always, never delete someone else's. |

## One show

`detected → scripted → recorded → narrated → rendered → sent → approved | changes_requested → (new round) …`

Every transition is stored with its time in `.showtime/shows/<story>/show.json`, which is where "UAT to approved in 5 minutes" comes from. Illegal jumps (for example `rendered → approved`) throw.

## What is on disk (`.showtime/`, git-ignored)

```
config.json                       UAT environment, CRT project and job, Slack channels, voice, sf alias
hints/<story>.txt                 exact labels for the AI (optional)
feedback/<story>.md               the business owner's comments, for the developer's agent
shows/<story>/script.yaml         what the robot does and what the narrator says (human-editable)
shows/<story>/frames/NN-<id>.png  one screenshot per step
shows/<story>/video/              the MP4, a preview, and render.json (hash, seconds)
shows/<story>/review.json         where the review card lives in Slack
shows/<story>/decision.json       the decision, who, when, and whether Copado has the note
shows/<story>/history/            decisions from earlier rounds
```

## How a decision is handled

1. Save `decision.json` and move the lifecycle (the source of truth).
2. Update the Slack card in place; on approval, tell the release channel (and remind them promotion is theirs).
3. For changes: append to `feedback/<story>.md`.
4. Write a dated block to the story's Technical Specifications field, under the shared lock, keeping all existing text. If the lock is held it retries, then marks the note `pending`. A Copado error never undoes the decision.

## Security model

- Slack tokens only in `.env`; `doctor` reads key *presence*, never values, and test results never contain them.
- The UAT login link carries a session: it is passed to `testing build run --variable`, masked in error messages, and never written to disk or logs.
- Showtime writes only to the Showtime CRT project, the UAT org (one demo Case per recording), one Slack workspace, and a note on the story.
- The skill, the MCP server and the code have no path to approve, promote or deploy.

## Decisions and mistakes

[`docs/decisions.md`](decisions.md) records every choice where the real CLI differed from the plan (capture approach, login, zoom), and two honest incidents (a screenshot that exposed a password; a story promoted one stage too far) with what changed because of them.
