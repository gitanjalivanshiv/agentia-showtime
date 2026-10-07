# Agentia Showtime — Build Brief for Claude Code

> How to use this file: this is `CLAUDE.md` at the root of `~/hackathon/showtime`. Open Claude Code in that folder and start with:
> **"Read CLAUDE.md and ~/hackathon/PLAYGROUND_RULES.md, then start Phase 0. Stop and report at the end of each phase."**

---

## 1. What we are building

**Every feature demos itself.** When a user story reaches UAT in Copado, Showtime:
1. has a **Copado Robotic Testing** robot walk through the story's acceptance criteria in the UAT org, capturing each screen;
2. has **Copado AI** write a short, friendly narration from the story;
3. assembles a polished **60–90 second narrated demo video**;
4. sends it to the **business owner in Slack** with **Approve** / **Request changes** buttons;
5. writes the decision back to **Copado** (approval → the release manager is cleared to promote; changes → feedback lands on the story for the developer and their AI agent);
6. *(stretch)* lets the business owner review and approve from **Agentforce inside Salesforce**;
7. *(stretch)* after release, posts the same video to end users as **"What's new for you."**

It is an entry for the **Copado Agentia™ Headless Virtual Hackathon** (deadline **Oct 26, 2026**). Judged 1–10 each on: Innovation, Impact, Technical Execution, **Use of Agentia™ Extensibility (skills, commands and MCP capabilities)**, and Presentation. Judges see only the public repo, a ≤ 5-minute video and a slide deck.

### The problem
UAT sign-off is where Salesforce releases stall. Business owners don't log into sandboxes, don't read user stories and don't know what to test, so stories wait for days for "looks good."

### Positioning (two Agentia + Slack tools are already public; we must be clearly different)
- **Fleet Radar** sends failure alerts and AI fix suggestions to Slack. **Slacktia** runs the CLI from a Slack slash command to create user stories.
- **Showtime closes the business sign-off loop**: pipeline-generated feature videos, human approval and feedback flowing back into Copado. It is not an alerting tool and not a chat front-end for the CLI. Say this in one honest line in the README and deck.

### The demo's "wow" moment
A Slack notification pops up, and **a video the pipeline made by itself plays inline**. The business owner taps **Approve**, and we cut to Copado showing the story cleared to move forward.

---

## 2. Hard constraints (read before writing any code)

1. **Plugin model.** The core is an **Agentia CLI plugin** (`agentia showtime …`), scaffolded with `npm init @copado/agentia-plugin <dir>` and linked with `agentia plugins link .`.
2. **Plugins CANNOT** call Agentia internals, wrap existing Agentia commands, or register tools with `agentia mcp start`. **Never import private Agentia source paths.** Every Copado interaction goes through **spawning the public `agentia` binary with `--json`**, behind one adapter (`AgentiaClient`).
3. **Own MCP server is allowed.** Like our Time Machine project, ship `agentia showtime mcp` as a separate stdio MCP server exposing Showtime's own tools (see §9).
4. **Never invent command names or flags.** Discover them with `--help` and record them in `docs/agentia-commands.md`. Read and follow the Agentia Skills generated in `.agents/skills/` (`agentia-cicd`, `agentia-testing`, `agentia-ai`).
5. **Robotic Testing rules (from Copado docs):**
   - CRT auth is separate. Gate on `agentia auth get --crt --json` → `ready: true`.
   - `--stream-logs` / `--watch` don't work with `--json`. Run with `--json`, poll `testing build get`, read `testing build logs`.
   - Files are never written implicitly. Always pass explicit `--output` / `--output-dir` / `--save-artifacts` paths.
   - `testing live` view and the long-running **recorder are CLI-only and the recorder has no `--json`**. Don't build on the recorder. Use live sessions with explicit screenshot capture, or job runs with saved artifacts (decide in Phase 0).
   - Destructive CRT operations need `--yes` / `confirm: true`.
6. **CI/CD rules:** Source Format pipelines only. Never mix local-flow and `--cloud` operations on one user story.
7. **The human always decides.** Showtime never promotes or deploys on its own. An approval records the decision and notifies the release manager, who promotes.
8. **Secrets** (Slack tokens, TTS keys, Agentforce credentials) live in `.env` (git-ignored) or the OS keychain. Never commit, log or print them. Provide `.env.example`.
9. **Public repo hygiene:** no org IDs, usernames, real record data or customer screenshots. The sample video in the repo must come from our invented demo app with fake data.

---

## 3. Shared playground (two other builds use the same Copado playground)

Read `~/hackathon/PLAYGROUND_RULES.md` and follow it. In short:
- **Showtime owns:** the user stories it creates (prefix `Showtime Demo –`), its own CRT project (`Showtime`), and the UAT environment assigned to it in `.showtime/config.json`.
- **Never touch:** Mutant's lab environment, Time Machine's data templates, the user's ILT playground, or the "Copado Business Applications" org's Salesforce environments (use that org only for its Robotic Testing service).
- **Lock:** before any **write to Copado** (creating or updating stories, commits, promotions), check `~/hackathon/.org-busy`. If present, show its contents and ask the user. While writing, create it with `showtime: <action> started <time>` and remove it when done (also on failure). Read-only calls and video recording in the UAT org don't need the lock.
- **Demo metadata** is deployed only through Showtime's own user stories into Showtime's environments.

---

## 4. Phase 0 — Discovery (do this first, then stop and report)

1. Check `node -v` (≥ 20), `agentia --version`, `ffmpeg -version` (install with Homebrew if missing, after asking), and that macOS `say` exists (`say -v '?' | head`).
2. Auth readiness: `agentia auth get --crt --json` (`ready: true`) and AI auth. If anything is missing, ask the user to run `agentia setup`. **Never handle credentials yourself.**
3. Save `--help` output for: `agentia cicd work …`, `cicd promotion …`, `cicd project …`, `cicd environment …`, `cicd notification …`, `testing project|job|build|live …`, `ai agent ask`, `ai workspace …`.
4. Answer, with real JSON samples (scrubbed) saved to `fixtures/raw/` (git-ignored):
   - **Find stories:** how to list user stories and see which environment/stage each is in (to detect "reached UAT").
   - **Read a story:** title, description, acceptance criteria, owner, environment.
   - **Write back:** which commands can record a decision on a story (status, a field, a comment or note, a test result?). If nothing suitable exists, propose an alternative (e.g. Showtime keeps the decision log and the release manager sees it in Slack) and **ask the user**.
   - **Capture screens:** compare two approaches and recommend one.
     - **A. Live session:** `testing live` start → execute keywords step by step → capture a screenshot after each step → stop.
     - **B. Job run:** generate a Robot Framework / QWords script, upload it to a CRT job, `testing build run --json`, poll, download artifacts (screenshots, log) with `--save-artifacts`.
     Report which gives clean, step-aligned screenshots and whether click coordinates or element positions are available (for highlight boxes).
   - **Copado AI:** `ai agent ask --json` response shape; which agent is best for narration (try Plan/Knowledge), typical latency.
5. **Slack:** confirm the user has a Slack workspace where they can install apps (a free developer/sandbox workspace is ideal). Check whether Slack's free plan limits matter for the demo (file uploads, Socket Mode).
6. Write `docs/agentia-commands.md` and `docs/decisions.md`.
7. **Stop.** Report findings, the recommended capture approach, the write-back approach, and anything blocking.

---

## 5. Architecture

```
                 ┌──────────────── agentia showtime (plugin) ─────────────────┐
 Copado story ──►│ Watcher → Scriptwriter → Recorder → Narrator → Editor      │
 reaches UAT     │      (poll)   (AI: steps    (CRT:      (AI text   (frames + │
                 │               + narration)  screens)   + voice)   ffmpeg)   │
                 │                                   │                         │
                 │                        Review Hub (local service)          │
                 │                  ┌────────────────┼──────────────────┐     │
                 └──────────────────┼────────────────┼──────────────────┼─────┘
                                    ▼                ▼                  ▼
                              Slack (Socket    Agentforce (stretch:   Copado (decision
                              Mode, Bolt)      REST via tunnel)       written back via agentia)
```

| Module | Responsibility |
|---|---|
| `src/agentia/client.ts` | Spawn `agentia … --json`, timeouts, zod validation, typed errors, fake runner for tests (`SHOWTIME_AGENTIA_BIN` override). |
| `src/watch/` | Poll Copado for `Showtime Demo –` stories that reached the configured UAT environment and have no "show" yet. |
| `src/script/` | Turn acceptance criteria into a **demo script**: ordered steps (navigate, click, type, verify) and one narration line per step. Uses `agentia ai agent ask`; validates the AI output against a schema; falls back to a hand-written script file if AI output is unusable. Human-editable `script.yaml`. |
| `src/record/` | Execute the demo script in the UAT org through CRT (approach chosen in Phase 0) and collect one screenshot per step. Retries flaky steps once. |
| `src/narrate/` | Voice per step. Default provider: **macOS `say`** (offline, free; configurable voice and rate). Pluggable interface for other TTS providers via env keys. Produces per-step audio + durations. |
| `src/edit/` | Video assembly: render **HTML/CSS frame templates** (title card, step cards, end card) to PNG with Playwright, with screenshot, caption, step counter, optional highlight box and gentle zoom. Then **ffmpeg** stitches frames + audio into MP4 (1080p and a small preview) with **burned-in captions**, because Slack autoplays muted. |
| `src/review/` | **Review Hub**: a small local service. Slack app via **Bolt for JS in Socket Mode** (no public URL needed). Posts the video + Block Kit message, handles Approve / Request changes (modal for comments), records decisions, writes back to Copado, notifies the release-manager channel. Stretch: REST API for Agentforce. |
| `src/store/` | `.showtime/` state: shows, scripts, assets, decisions (JSON files; SQLite only if needed). |

### Show lifecycle
`detected → scripted → recorded → narrated → rendered → sent → approved | changes_requested → (stretch) announced`
Every transition is logged with time, so the deck can show a real timeline ("UAT to approved in 11 minutes").

---

## 6. Commands

| Command | Behaviour |
|---|---|
| `agentia showtime init` | Creates `.showtime/config.json` (UAT environment, CRT project, Slack channels for owners and release managers, voice), checks `.env`, installs the Agent Skill. |
| `agentia showtime doctor` | Checks CRT/AI auth readiness, ffmpeg, `say`, Slack connection and config. Plain-English fixes for anything missing. |
| `agentia showtime script <story>` | Generates `script.yaml` (steps + narration) for review. `--edit` opens it. |
| `agentia showtime record <story>` | Runs the script in UAT and captures screens. |
| `agentia showtime render <story>` | Narration + video. Prints the MP4 path and length. |
| `agentia showtime send <story>` | Posts to Slack for review. |
| `agentia showtime run <story>` | `script → record → render → send` in one go, with a progress line per stage. **This is the demo command.** |
| `agentia showtime watch` | Polls Copado and runs shows automatically when stories reach UAT. |
| `agentia showtime serve` | Starts the Review Hub (Slack Socket Mode; stretch: Agentforce REST). |
| `agentia showtime status [story]` | Lifecycle, decisions and timings. |
| `agentia showtime mcp` | Stdio MCP server (§9). |

All commands support `--json` and `--dry-run` where they write.

---

## 7. Slack experience (design this carefully: it's what judges see)

- **Owner message** in `#uat-reviews` (or a DM to the owner):
  - Header: "🎬 Your feature is ready to review: *Case Escalation for VIP customers*"
  - The MP4, uploaded with `files.uploadV2` so it plays inline
  - 2–3 bullet summary from the story, plus "What to check"
  - Buttons: **✅ Approve** · **✏️ Request changes** (opens a modal with a comment box) · **🔗 Open in UAT**
- After a decision, the message updates in place: "Approved by Priya at 14:32" or "Changes requested: '…'".
- **Release manager** message in `#release`: "Approved for release: <story> · video · approved by · time", with a reminder that promotion is theirs to do.
- **Developer** feedback: the comment goes to the story (write-back from Phase 0) and to `.showtime/feedback/<story>.md`, which the Agent Skill tells the developer's AI agent to read.
- Use Block Kit Builder–quality layouts. No walls of text.

## 8. Video design

- 1920×1080, 60–90 seconds, clean brand-neutral look. One accent colour, readable font, subtle motion (slow zoom on each screenshot, highlight box on the clicked element if positions are available).
- Structure: title card (feature name, story ID) → 4–7 step cards (screenshot + caption + narration) → end card ("Approve in Slack").
- Captions burned in. Background music: none, or a very quiet royalty-free track the user supplies. Never bundle copyrighted audio.
- Narration style: warm, plain English, second person ("Here's what changes for your service team…"). Max ~20 words per step.
- Deterministic: same inputs give the same video, so re-renders don't surprise anyone.

---

## 9. Agent Skill + MCP (the "skills and MCP capabilities" criterion)

**Skill** `skills/showtime/SKILL.md`, mirroring the structure of the Agentia Skills in `.agents/skills/`. It teaches a coding agent to:
- After promoting a story to UAT, run `agentia showtime run <story>` (or confirm `watch` is running) and tell the user the video was sent.
- When asked "what did the business say?", read `agentia showtime status --json` and `.showtime/feedback/`, then plan the fix.
- Never mark a story approved itself, and never promote on the business owner's behalf.

**MCP server** `agentia showtime mcp` exposes: `showtime_status`, `showtime_run`, `showtime_feedback`, `showtime_script_preview`. Write tools need explicit confirmation arguments, like Time Machine's preview-then-apply pattern. `agentia showtime init` can register it with Claude Code (`claude mcp add showtime -- agentia showtime mcp`) after asking.

---

## 10. Agentforce (stretch, only after the Slack flow is demo-ready)

- The Review Hub exposes a small authenticated REST API: `GET /reviews?owner=…`, `POST /reviews/{id}/decision`, and a video URL.
- Expose it over HTTPS with a tunnel (e.g. `cloudflared`) for the demo.
- In a **separate Agentforce-enabled Salesforce org** (a developer org, not the playground's UAT org), create: an OpenAPI External Service + Named Credential, and Agentforce actions **"Show my pending reviews"** and **"Approve / request changes"**.
- Provide the setup as metadata and instructions in `examples/agentforce/`. Never commit credentials.
- Demo line: the business owner types *"What's ready for me to review?"* in Salesforce, gets the video link and approves without leaving Salesforce.

---

## 11. Demo sample app (invented, safe to publish)

Different from Mutant's sample app, to avoid confusion.
`examples/demo/force-app/`: **"VIP Case Escalation"**:
- Field `Account.VIP__c` (checkbox), shown on the Account layout
- Record-triggered Flow: new Case on a VIP account → Priority = High, plus a "VIP" badge field on Case
- Case Lightning page / layout change so the badge is visible
- Seed data: one fake VIP account, one normal account (obviously fictional names)

`examples/demo/seed.sh` creates the `Showtime Demo –` user story and deploys through Agentia into Showtime's environments (asks first). `reset.sh` restores the starting state. Include a sample rendered MP4 and a screenshot of the Slack message in `docs/` for judges.

---

## 12. Tech stack and quality bar

- TypeScript (strict), oclif, zod, execa, `@slack/bolt` (Socket Mode), Playwright (frame rendering only), ffmpeg (system), macOS `say` as default TTS.
- vitest: script schema validation, lifecycle state machine, Slack payload builders (snapshot tests), ffmpeg command builder, fake `AgentiaClient` with scrubbed fixtures.
- An **offline demo** (`examples/demo/try-offline.sh`) using fakes and bundled sample screenshots that renders a real video and prints the Slack payload. Judges can run it without Copado or Slack.
- ESLint + Prettier, CI on GitHub Actions with fakes. MIT licence; declare open-source components.

## 13. Repository deliverables

```
README.md            # GIF of the Slack message + video, 3-line pitch, positioning line, setup, "Built on Agentia" command list
docs/agentia-commands.md  docs/decisions.md  docs/architecture.md  docs/slack-setup.md
skills/showtime/SKILL.md
examples/demo/ (sample app, seed.sh, reset.sh, try-offline.sh, sample.mp4)
examples/agentforce/ (stretch)
slack-app-manifest.yml   # one-click Slack app creation
.env.example  src/  test/  fixtures/  LICENSE
```

---

## 14. Demo video to support (≤ 5 minutes)

1. **Hook (20s):** "Your feature is done. Now it waits four days for someone to click through UAT."
2. **Developer (30s):** In Claude Code, the agent promotes the VIP Case Escalation story to UAT, then (following the skill) runs Showtime.
3. **Behind the scenes (45s, time-lapsed):** script → robot walking through Salesforce → narration → render.
4. **Wow (45s):** Slack pings. The business owner's message, with the video playing inline.
5. **Request changes (40s):** Owner asks "Also escalate for Platinum accounts." The developer's agent picks up the feedback.
6. **Approve (30s):** Second round. Owner taps Approve, the release channel gets "approved for release," and Copado shows the decision.
7. *(Stretch, 30s)* Same review from Agentforce inside Salesforce.
8. **Close (15s):** "Copado ships it. Showtime shows it."

---

## 15. Phases and checkpoints

Stop at the end of each phase and report what was done, what was verified and any decisions needed.

| Phase | Scope | Done when |
|---|---|---|
| 0 | Discovery (§4) | Capture approach and write-back approach chosen with the user |
| 1 | Scaffold, link, AgentiaClient + fakes, `init`, `doctor` | `doctor` all green |
| 2 | Demo app seeded into Showtime's environments via Agentia | Story in UAT, app visible in UAT org |
| 3 | `script` (AI + schema + fallback) | Sensible `script.yaml` for the demo story |
| 4 | `record` | One clean screenshot per step from the UAT org |
| 5 | `render` (narration, frames, ffmpeg, captions) | A video you'd be happy to show; offline demo renders too |
| 6 | Review Hub + Slack (`send`, `serve`, decisions, release channel, write-back) | Full approve and request-changes loop works in Slack |
| 7 | `run`, `watch`, `status`, Agent Skill, MCP server | Claude Code follows the skill unprompted |
| 8 | README, docs, Slack manifest, sample assets, CI, polish | Fresh clone → offline demo works in < 5 min |
| 9 | *(Stretch)* Agentforce, then "What's new" announcement | Approve from Salesforce works |

## 16. Working rules for Claude Code

- Ask before anything that **writes to Copado** (stories, commits, promotions, CRT uploads) or **posts to Slack** for the first time in a session. Read-only calls are fine.
- Showtime environments only. Never production, never the ILT playground, never Mutant's lab or Time Machine's templates.
- Commit in small, well-described steps.
- If the real CLI behaves differently from this brief, **trust the CLI**, log it in `docs/decisions.md`, and tell the user.
- Video and Slack polish matter as much as code here. When in doubt, show the user a frame or a Slack preview before moving on.
