# Decisions

## D1 — ffmpeg via `ffmpeg-static` (2026-10-07)
Homebrew is not installed on the dev machine, and a system ffmpeg would be a setup hurdle for judges.
Showtime depends on the `ffmpeg-static` npm package (ffmpeg 6.0, includes libx264 and aac).
Resolution order in `src/edit/`: `SHOWTIME_FFMPEG` env var → system `ffmpeg` on PATH → `ffmpeg-static`.
Captions are burned in from Playwright-rendered frames, so ffmpeg's `drawtext`/libfreetype is not needed.
Note: ffmpeg-static has an npm install script; the plugin's `package.json` must allow it to run.
This departs from the brief's "ffmpeg (system)".

## D2 — Playground rules saved (2026-10-07)
`~/hackathon/PLAYGROUND_RULES.md` was missing; created from the text the user supplied. Its environment-name blanks are still unfilled, so Showtime writes nothing to Copado until UAT/dev environments are named.

## D3 — Initial commit before `agentia setup` (2026-10-07)
`agentia setup skills create` runs `git rev-parse HEAD` and fails in a repo with no commits. `.agents/`, `.agentia/` and `AGENTS.md` are git-ignored per the playground rules.

## D4 — Proposed write-back (pending user approval)
No comment/note command exists. Proposal: `work update --status` is avoided (shared pipeline statuses); instead append a dated "Showtime review" block to `--technical-specifications` (30000 chars) for decisions and feedback, keep the full log in `.showtime/`, and notify the release channel in Slack.

## D5 — Proposed capture approach (pending verification)
Live session (A): step-aligned by construction (execute a line, then screenshot). Needs a CRT project and job first. Job run (B) not tested. Element coordinates unknown; check `testing live inspect` output once a session runs.

## D4 update — write-back approved (2026-10-07)
User approved: append a dated "Showtime review" block to the story's `--technical-specifications`; full log in `.showtime/`; release manager notified in Slack. Never touch `--status`.

## D6 — Pipeline shape (2026-10-07, from user screenshot)
Dev1-SFP, Dev2-SFP → INT-SFP → UAT-SFP → Production-SFP; Hotfix-SFP → Production-SFP. UAT-SFP's source is INT-SFP. Mutant stories were seen on INT-SFP, so Showtime must not write there. Showtime dev source is still undecided.

## D7 — CRT project creation blocked (2026-10-07)
`testing project create --name Showtime` returned HTTP 403 (TestingGatewayError). Lock was taken and released. No project exists. Likely the PAK lacks create-project permission; to be fixed in the CRT UI.

## D8 — Slack limits (researched 2026-10-07)
Free workspace: 90-day visible history, up to 10 third-party/custom apps, 5 GB shared file storage, throttling of bursts of messages/files. Socket Mode: up to 10 connections, no plan restriction stated, not allowed on the public Marketplace (irrelevant for a hackathon). A free Slack Developer Program sandbox (Enterprise Grid, up to 10 sandboxes, 180 days, all paid features) is the best choice. Per-file upload size and inline playback of `files.uploadV2` video are not confirmed by these sources and must be tested.

## D9 — CRT lives on a different domain/org (2026-10-07)
The 403 came from the globally stored CRT auth, which pointed at a different CRT domain and organization than the Showtime project. Showtime needs project-local CRT auth (`agentia auth set --local --crt <pak> --crt-domain <domain> --crt-org <org-id>`) so the global auth used by Time Machine and Mutant is not changed. Credentials are entered by the user, never by Claude.

## D10 — Environment ownership (2026-10-07)
Time Machine used Dev1-SFP, Mutant used Dev2-SFP. Showtime's UAT is UAT-SFP (source INT-SFP). Showtime's dev source is still undecided. Playground rules file deferred by the user.

## D11 — Plugin scaffolded by hand (2026-10-07)
`npm init @copado/agentia-plugin` is interactive and exits on piped input, so the plugin layout was written by hand, mirroring the structure of the sibling Agentia plugins (oclif, ESM, `commands: ./dist/commands`, topic `showtime`). It links and runs with `agentia plugins link .`.

## D12 — Local CRT auth and the Showtime config (2026-10-07)
CRT credentials for Showtime are project-local (`agentia auth set --local`), so `doctor` and every client call run with `cwd` = the project root. Config lives in git-ignored `.showtime/config.json`: UAT-SFP, dev source INT-SFP, CRT project ID in the config.

## D13 — Capture approach: job runs (B), not live sessions (A) (2026-10-08)
Measured on the Showtime CRT project:
- **A. Live session:** `testing live screenshot` always returns an annotated overlay (dimmed page, numbered coloured boxes). It cannot be switched off with `set-options`, and it survives navigation. Unusable as a video frame. `testing live inspect` lists elements (selector, label, xPath) but gives no coordinates. Start takes about 15 s.
- **B. Job run:** a robot that calls `LogScreenshot` after each step produces clean 1920×993 PNGs. `testing build run --wait-for-result --save-artifacts <file>` writes a zip with `output.xml`, `log.html`, `report.html`, `xunit_report.xml` and `screenshots/`. One short test took about a minute.
Decision: record with B. Showtime generates a Robot Framework file from `script.yaml`, uploads it with `testing job upload --replace`, runs it, unpacks the zip, and maps screenshots to steps with `Log SHOWTIME_STEP:<id>` marker keywords found in `output.xml`.
Highlight boxes: no element coordinates are available from the CLI. If wanted, a step can inject an outline onto the target element with `Execute JavaScript` just before `LogScreenshot`.
Credentials: CRT variables `UAT_USERNAME` and `UAT_PASSWORD` (sensitive) are read by the robot; the password is typed with `TypeSecret`. Showtime never sees the value.

## D14 — Incident: story promoted past UAT to Production-SFP (2026-10-09)
Approved: INT-SFP → UAT-SFP (P00015, 2026-10-08). While fixing the demo layout I ran `work submit` / `work submit --deploy` again. After the first promotion the story's environment was already UAT-SFP, so Copado promoted UAT-SFP → Production-SFP (P00016 validated, P00017 completed, 2026-10-09). That environment name matches the playground rule "never touch production-like environments", and it was not approved. No further writes were made. Rule going forward: before any `submit`, read the story's `sourceEnvironmentName` and the promotion's destination; `--deploy` only with an explicit, named destination from the user.

## D15 — Recorder login: one-time Salesforce link, no stored password (2026-10-09)
The sandbox login page flips between layouts and hides its password field, so a typed password ended up in a screenshot and the password was rotated. Recording now logs in with the one-time link from `sf org open --url-only` (the user authorizes the org once with `sf org login web`). The link goes to the robot as the CRT variable `FRONTDOOR_URL` (Robot format `NAME:VALUE`), is never saved to disk or logged, and is masked in error messages. `UAT_PASSWORD` is no longer used, and the variable was deleted from the CRT project on 2026-10-10.

## D16 — Demo layouts and UAT deploy (2026-10-09)
The first trimmed Account layout dropped the standard actions and the Cases related list, so the robot found no "New Case" button. The layout now carries `platformActionList` (Edit, New Case, New Contact, Delete) and a Cases related list. After the incident in D14 the corrected layout was deployed straight to UAT with `sf project deploy start --ignore-conflicts`, so the UAT org is ahead of the `uat-sfp` branch for that one file.
Each recording creates one Case on the VIP account. `examples/demo/reset.sh` (Phase 8) must delete Cases whose subject is "Order portal is down".

## D17 — Video rendering (2026-10-09)
Cards (background, per-step caption/progress overlay, title, end) are HTML rendered to PNG by Playwright; ffmpeg composites the still recorded screen (a slow zoom was tried and removed: it cropped the edges and looked like a glitch), delays the narration by 0.6 s, concatenates the segments and writes a 1080p MP4 plus a 960×540 preview. Encoding uses `-fflags +bitexact -map_metadata -1`, and two renders from scratch gave identical SHA-256 hashes. A render hash (script, frames, voice, ffmpeg version, card HTML) lets an unchanged story reuse its video. Holds: 7.5 s minimum per step, 5 s for the title and end cards, so 7 steps land near 65 s. Narration: macOS `say`, voice and rate from `.showtime/config.json` (default Samantha, 165 wpm), behind a `Tts` interface.

## D18 — Slack review loop design (2026-10-09)
- **Two messages, not one:** the MP4 is uploaded with `files.uploadV2` so it plays inline, and the review card with its buttons is posted straight after. A file upload cannot carry Block Kit buttons, and a `video` block needs an embeddable URL, which an uploaded file is not.
- **Socket Mode** (Bolt) for button clicks and the modal, so no public URL is needed. `send` uses only the bot token (a plain Web API client); `serve` needs the bot and app-level tokens.
- **Local record first:** a decision is written to `.showtime/shows/<story>/decision.json` and the lifecycle moves before Slack or Copado are touched. The card update, the release-channel notice, and the Copado note follow. A Copado problem (lock held by another project, or an error) leaves the decision intact and marks the note `pending` or `failed`.
- **Write-back** is a dated "Showtime review" block appended to the story's Technical Specifications field (D4). Existing text is preserved; only older Showtime blocks are dropped if the 30000-character limit is reached. Status is never changed.
- **Never promotes:** approval notifies the release channel and says promotion is theirs. No code path calls `submit`, `promote` or `done`.
- **Clicks are idempotent:** a second click gets a private reply. Optional `slack.approverIds` limits who may decide.

## D19 — Phase 7: run, watch, MCP, skill (2026-10-10)
- **One pipeline:** `script`, `record`, `render` and `send` are plain functions in `src/pipeline.ts`; the commands, `run`, `watch` and the MCP server all call them. `runPipeline` stops at the first failing stage and names it.
- **watch** finds stories titled `Showtime Demo –…` whose environment is the UAT environment and that are new, or that changed after "changes requested". Our own note on the story changes its last-modified time, so a 30 s margin after the note's write time is ignored. Two failed attempts stop retries (`failure.json`); a held shared lock is "try again next poll", never a failure.
- **MCP:** `showtime_status`, `showtime_feedback`, `showtime_script_preview` (read) and `showtime_run` (write, plan first, `confirm: true` to apply). No tool approves, promotes or deploys. stdout carries only protocol; other plugins' warnings go to stderr (verified with a handshake).
- **Skill acceptance test** (`claude -p` in the developer repo, write tools not allowed):
  1. The skill alone was **not** enough: asked "what should happen next?" after a promotion, the agent answered from the project's own Copado workflow notes and never mentioned Showtime. A sharper description did not change that.
  2. Adding a short managed block to the project's instruction file (`CLAUDE.md` for Claude Code, `AGENTS.md` otherwise, between `<!-- showtime:start/end -->`) did: the agent ran `showtime doctor` first, laid out the steps, asked before anything that writes, and refused to approve or promote. Same mechanism Agentia uses to name its own skills in AGENTS.md.
  3. `install-skill` also writes `.showtime-root` in the developer repo so the CLI finds Showtime's state from there.

## D20 — Round 2 as a new story (2026-10-10)
The owner's feedback on US-0000036 ("Also escalate cases for Platinum accounts") was delivered as a **new** story, US-0000037, on INT-SFP, because US-0000036 had already been promoted past UAT (D14) and a repeat promotion would have moved it onward again. Flow: check-only deploy to UAT (7/7 components) → publish → validate (all three jobs checked, destination read from the output: INT-SFP → UAT-SFP) → deploy P00019 INT-SFP → UAT-SFP → `watch --once` saw the story arrive in UAT and ran script → record → render → send by itself in 1 min 48 s. Change: `Account.Tier__c` (Standard/Platinum), the flow escalates VIP **or** Platinum, the badge reads VIP CUSTOMER or PLATINUM CUSTOMER, plus layout and permission-set updates.
