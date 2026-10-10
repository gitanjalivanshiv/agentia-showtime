# Showtime commands

All commands accept `--json`. Run them from the folder that holds `.showtime/`, or set `SHOWTIME_ROOT`.

| Command | What it does | Writes to |
|---|---|---|
| `agentia showtime init` | Creates `.showtime/config.json` (UAT environment, CRT project and job, Slack channels, voice, `sfAlias`). `--force` overwrites. | local |
| `agentia showtime doctor` | Checks sign-ins, the CRT project and job, the UAT org login (Salesforce CLI), ffmpeg, the narration voice and Slack. Every failing check has a `fix`. | nothing |
| `agentia showtime script <story>` | Asks Copado AI for steps and narration, validates them, writes `.showtime/shows/<story>/script.yaml`. `--dry-run`, `--no-ai`, `--fallback <file>`, `--hint "<exact labels>"`, `--edit`. | local |
| `agentia showtime record <story>` | Runs the script in UAT with Robotic Testing and saves one screenshot per step. Takes the shared lock. | Robotic Testing, UAT org (one Case per run) |
| `agentia showtime render <story>` | Narrates and builds the 1080p MP4 plus a preview. `--stills` for review frames, `--force`. Deterministic. | local |
| `agentia showtime send <story>` | Uploads the video and posts the review card. `--dry-run` prints the message. | Slack |
| `agentia showtime run <story>` | `script → record → render → send` with a progress line per stage. `--skip-send`, `--from <stage>`, `--no-ai`, `--hint`, `--dry-run`. | all of the above |
| `agentia showtime watch` | Polls Copado; runs a show for every `Showtime Demo –` story that reaches the UAT environment or returns after changes. `--once`, `--interval <s>`, `--dry-run`. | as `run` |
| `agentia showtime serve` | The Review Hub: listens for Approve / Request changes in Slack (Socket Mode) and records decisions. Keep it running. | Slack, Copado note |
| `agentia showtime status [story]` | Lifecycle with times, decision, Copado note state. | nothing |
| `agentia showtime install-skill` | Copies this skill into a project (`--dir`, `--target agents|claude|cursor`). | local |
| `agentia showtime mcp` | Stdio MCP server with the four tools below. | per tool |

## MCP tools

| Tool | Read or write | Input |
|---|---|---|
| `showtime_status` | read | `story?` |
| `showtime_feedback` | read | `story` |
| `showtime_script_preview` | read (asks Copado AI) | `story`, `hint?`, `noAi?` |
| `showtime_run` | **write**: call once without `confirm` for the plan, again with `confirm: true` after the user agrees | `story`, `confirm?`, `skipSend?`, `hint?`, `noAi?` |

There is no tool to approve, promote or deploy.

## Key JSON

`status --json` → `{shows: [{story, state, history: [{state, at, note?}], secondsToDecision?, decision?: {kind, by, at, comment?, copado}, videoUrl?}]}`

`run --json` → `{story, stages: [{stage, detail, seconds}]}`; a failure exits non-zero with `<stage> failed: <reason>`.

Exit codes: `0` ok, `1` a stage failed, `2` the shared lock is held by another tool.
