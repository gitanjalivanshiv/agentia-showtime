# Agentia commands used by Showtime

Discovered with `--help` on `@copado/agentia-cli/1.0.0-beta.2`. Every call goes through `AgentiaClient` (spawn `agentia … --json`).
Output is `{ result, status, transactionId }`; the CLI prints linked-plugin warnings on stderr/stdout lines starting with `›`, so strip them before parsing.

## Auth (read-only)
- `agentia auth get --crt --json` → `result.credentials[0].ready` (gate)
- `agentia auth get --json` → CICD, CRT and AI credential status (values are masked)

## Copado stories
| Need | Command | Notes |
|---|---|---|
| List / detect UAT | `cicd work list --json` | Paged (`pageSize` 25, `hasMore`). Fields: `name`, `title`, `status`, `owner`, `sourceEnvironmentName`, `pipelineId`, `lastModifiedDate`. "Reached UAT" = `sourceEnvironmentName` equals the configured UAT environment. |
| Read | `cicd work get <id\|name> --json` | Same fields. Description/acceptance criteria were not in the sample (empty fields are omitted); verify on a story that has them. |
| Create | `cicd work create` | Write. Needs lock. |
| Write back | `cicd work update <id> …` | Write. Flags: `--status`, `--acceptance-criteria` (255), `--functional-requirements` (30000), `--technical-specifications` (30000), `--title`, `--priority`. No comment/note command exists. |
| Promote | `cicd work submit --deploy` / `cicd promotion run` | Never called by Showtime (human decides). |

## Robotic Testing
- `testing project list|create|get`, `testing job create|run|download|files`, `testing build run|get|logs|list`
- Live: `testing live start <job-id> -p <project> --json`, `execute --line "…"`, `screenshot -p <project> -o <file>`, `inspect`, `status`, `stop --yes`
- `recorder` and `view` are CLI-only; not used.

## Copado AI
- `ai agent ask --agent plan|build|test|release|operate|knowledge -p "<prompt>" --no-stream --json`
- Response text is in `result.content`. Extra keys: `completed`, `dialogueId`, `requestId`, `warnings`.
- Observed: ~7 s for a short prompt; `completed: false` plus an "AI stream ended before stream_complete" warning even though the content was whole. Treat `content` as the answer, validate it with zod.
- Pass `--no-credential-sync` to suppress the "no CICD project default credential" warning.
