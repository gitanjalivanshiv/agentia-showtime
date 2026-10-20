# Agentia commands used by Showtime

Discovered with `--help` on `@copado/agentia-cli` 1.0.0-beta.2. Every call goes through `AgentiaClient` (spawn `agentia … --json`). The envelope is `{result, status, transactionId}` or `{error}`; the CLI prints other plugins' warnings on lines starting with `›`, so output is parsed from the first `{`.

## Auth (read-only)
- `agentia auth get --crt --json` → `credentials[].ready` gates Robotic Testing.
- `agentia auth get --json` → CICD, CRT and AI credential status (values are masked).
- CRT credentials can be project-local: `agentia auth set --local --crt <pak> --crt-domain <domain> --crt-org <id>` (so other projects' auth is not disturbed).

## Copado stories
| Need | Command | Notes |
|---|---|---|
| Find stories | `cicd work list --title <prefix> --page-size 100` | Fields used: `name`, `title`, `sourceEnvironmentName`, `lastModifiedDate`. "Reached UAT" = `sourceEnvironmentName` equals the configured UAT environment. |
| Read | `cicd work get <name>` | Includes `technicalSpecifications` when set. |
| Write back | `cicd work update <id> --technical-specifications <text>` | There is no comment command, so a dated Showtime block is appended to this field. Status is never changed. |
| Deployment finished? | `cicd promotion list --work-id <story record id> --page-size 50` | `--work-id` needs the record ID, not the `US-…` name. `work submit --deploy` returns while the deployment still runs, so before recording Showtime waits until the newest promotion into UAT has `status` `Completed`. |
| Create / set / publish / submit | `cicd work create`, `work set`, `work publish`, `work submit [--deploy]` | Used by `examples/demo/seed.sh`, never by Showtime itself. `submit` promotes to the story's **next** environment, so always read the destination first. |

## Robotic Testing
- `testing project list`, `testing job list -p <project>` (to find the "Showtime Recorder" job)
- `testing job upload <job> -p <project> --replace <local>:<remote> --message <text>`
- `testing build run <job> -p <project> --wait-for-result --timeout 900 --save-artifacts <file.zip> --variable NAME:VALUE` (Robot's `NAME:VALUE` format, not `NAME=VALUE`)
- The artifact zip holds `output.xml`, `log.html`, `report.html`, `xunit_report.xml` and `screenshots/`.
- `testing live screenshot` always returns an annotated overlay (see D13) and is not used.

## Copado AI
- `ai agent ask --agent plan --no-stream --no-credential-sync -p "<prompt>" --json`
- The answer is in `result.content`. `completed: false` plus a "stream ended before stream_complete" warning appears even when the answer is whole, so the content is validated, not the flag. About 7–16 s.

## Not Agentia, but used
- `sf org open -o <alias> --url-only --json`: a one-time login link for the robot.
- `sf org display`, `sf data query/create`: `doctor` and the demo seed/reset only.
