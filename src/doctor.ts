import fs from 'node:fs'
import path from 'node:path'

import {execa} from 'execa'

import type {AgentiaClient} from './agentia/client.js'
import {Copado} from './agentia/copado.js'
import {loadConfig} from './config.js'
import {loadDotEnv} from './env.js'
import {checkSfOrg} from './record/frontdoor.js'
import {resolveFfmpeg} from './util/ffmpeg.js'

export type CheckStatus = 'ok' | 'warn' | 'fail'
export interface Check {
  id: string
  label: string
  status: CheckStatus
  detail: string
  /** Plain-English fix, shown for anything that is not ok. */
  fix?: string
}

export interface DoctorDeps {
  root: string
  client: AgentiaClient
  env?: NodeJS.ProcessEnv
  nodeVersion?: string
  /** Lists macOS `say` voices; injectable for tests. */
  sayVoices?: () => Promise<string[] | undefined>
  /** Checks the Salesforce CLI alias of the UAT org; injectable for tests. */
  sfOrg?: (alias: string) => Promise<{ok: boolean; detail: string}>
  /** Calls Slack's auth.test with the bot token; injectable for tests. */
  slackAuth?: (botToken: string) => Promise<{ok: boolean; detail: string}>
}

/** Names of keys in a .env file. Values are never read into results. */
export function envKeys(root: string): Set<string> {
  const file = path.join(root, '.env')
  if (!fs.existsSync(file)) return new Set()
  const keys = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*\S/.exec(l)?.[1])
    .filter((k): k is string => Boolean(k))
  return new Set(keys)
}

async function listSayVoices(): Promise<string[] | undefined> {
  const r = await execa('say', ['-v', '?'], {reject: false, timeout: 15_000})
  if (r.failed || typeof r.stdout !== 'string') return undefined
  return r.stdout
    .split('\n')
    .map((l) => l.split(/\s{2,}/)[0]?.trim() ?? '')
    .filter(Boolean)
}

async function slackAuthTest(botToken: string): Promise<{ok: boolean; detail: string}> {
  try {
    const {WebClient} = await import('@slack/web-api')
    const r = await new WebClient(botToken).auth.test()
    return {ok: true, detail: `connected to ${r.team ?? 'the workspace'} as ${r.user ?? 'the app'}`}
  } catch (e) {
    return {
      ok: false,
      detail: `Slack rejected the token (${e instanceof Error ? e.message.slice(0, 80) : 'unknown error'})`,
    }
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function runDoctor(deps: DoctorDeps): Promise<Check[]> {
  const env = deps.env ?? process.env
  const copado = new Copado(deps.client, deps.root)
  const checks: Check[] = []
  const add = (c: Check) => checks.push(c)

  const major = Number((deps.nodeVersion ?? process.versions.node).split('.')[0])
  add(
    major >= 20
      ? {id: 'node', label: 'Node.js', status: 'ok', detail: `v${deps.nodeVersion ?? process.versions.node}`}
      : {
          id: 'node',
          label: 'Node.js',
          status: 'fail',
          detail: 'Node 20 or newer is required',
          fix: 'Install Node 20+ (for example with nvm).',
        },
  )

  // CRT auth is separate from CICD and AI auth (brief §2.5).
  let crtReady = false
  try {
    const crt = await copado.crtAuth()
    crtReady = crt?.ready === true
    add(
      crtReady
        ? {
            id: 'crt-auth',
            label: 'Robotic Testing sign-in',
            status: 'ok',
            detail: `ready (${crt?.source ?? 'unknown'} credentials)`,
          }
        : {
            id: 'crt-auth',
            label: 'Robotic Testing sign-in',
            status: 'fail',
            detail: 'CRT credentials are missing or not ready',
            fix: 'Run `agentia auth set --local --crt <pak> --crt-domain <domain> --crt-org <org-id>` in this folder.',
          },
    )
  } catch (e) {
    add({
      id: 'crt-auth',
      label: 'Robotic Testing sign-in',
      status: 'fail',
      detail: message(e),
      fix: 'Check that `agentia` is installed and on your PATH, then run `agentia setup`.',
    })
  }

  try {
    const creds = await copado.auth()
    for (const [type, label, fix] of [
      ['cicd', 'Copado API key', 'Run `agentia setup` and add your Copado API key.'],
      ['ai', 'Copado AI sign-in', 'Run `agentia setup` and configure Copado AI.'],
    ] as const) {
      const c = creds.find((x) => x.type === type)
      add(
        c?.set
          ? {id: `${type}-auth`, label, status: 'ok', detail: 'configured'}
          : {id: `${type}-auth`, label, status: 'fail', detail: 'not configured', fix},
      )
    }
  } catch (e) {
    add({id: 'cicd-auth', label: 'Copado sign-in', status: 'fail', detail: message(e)})
  }

  const loaded = loadConfig(deps.root)
  if (!loaded.ok) {
    add({
      id: 'config',
      label: 'Showtime config',
      status: 'fail',
      detail:
        loaded.reason === 'missing' ? '.showtime/config.json not found' : `invalid config: ${loaded.message}`,
      fix: 'Run `agentia showtime init`.',
    })
  } else {
    const cfg = loaded.config
    add({
      id: 'config',
      label: 'Showtime config',
      status: 'ok',
      detail: `UAT ${cfg.uatEnvironment}, CRT project ${cfg.crtProjectId}`,
    })
    const sf = await (deps.sfOrg ?? ((a: string) => checkSfOrg(a, env)))(cfg.sfAlias)
    add(
      sf.ok
        ? {id: 'uat-org', label: 'UAT org login (Salesforce CLI)', status: 'ok', detail: sf.detail}
        : {
            id: 'uat-org',
            label: 'UAT org login (Salesforce CLI)',
            status: 'fail',
            detail: sf.detail,
            fix: `Authorize the UAT org once: sf org login web --alias ${cfg.sfAlias} --instance-url <your UAT org URL>`,
          },
    )
    if (crtReady) {
      try {
        const projects = await copado.crtProjects()
        const p = projects.find((x) => x.id === cfg.crtProjectId)
        add(
          p
            ? {id: 'crt-project', label: 'CRT project', status: 'ok', detail: `"${p.name}" is reachable`}
            : {
                id: 'crt-project',
                label: 'CRT project',
                status: 'fail',
                detail: `project ${cfg.crtProjectId} is not visible to this sign-in`,
                fix: 'Check the project ID in .showtime/config.json and that the CRT organization matches.',
              },
        )
      } catch (e) {
        add({id: 'crt-project', label: 'CRT project', status: 'fail', detail: message(e)})
      }
      try {
        const jobs = await copado.crtJobs(cfg.crtProjectId)
        const j = cfg.crtJobId === undefined ? undefined : jobs.find((x) => x.id === cfg.crtJobId)
        add(
          j
            ? {id: 'crt-job', label: 'CRT recorder job', status: 'ok', detail: `"${j.name}" is reachable`}
            : {
                id: 'crt-job',
                label: 'CRT recorder job',
                status: 'fail',
                detail:
                  cfg.crtJobId === undefined
                    ? 'no crtJobId in the config'
                    : `job ${cfg.crtJobId} was not found`,
                fix: 'Create a job named "Showtime Recorder" in the CRT project, then run `agentia showtime init --force`.',
              },
        )
      } catch (e) {
        add({id: 'crt-job', label: 'CRT recorder job', status: 'fail', detail: message(e)})
      }
    }
  }

  const ff = await resolveFfmpeg(env)
  add(
    ff
      ? {id: 'ffmpeg', label: 'ffmpeg', status: 'ok', detail: `${ff.version} (${ff.source})`}
      : {
          id: 'ffmpeg',
          label: 'ffmpeg',
          status: 'fail',
          detail: 'no ffmpeg found',
          fix: 'Run `npm install` (ffmpeg-static is bundled) or set SHOWTIME_FFMPEG to an ffmpeg binary.',
        },
  )

  const voices = await (deps.sayVoices ?? listSayVoices)()
  if (!voices) {
    add({
      id: 'say',
      label: 'Narration voice (macOS say)',
      status: 'fail',
      detail: '`say` is not available',
      fix: 'Narration uses macOS `say`. Run on a Mac, or configure another voice provider.',
    })
  } else if (loaded.ok && !voices.includes(loaded.config.voice.name)) {
    add({
      id: 'say',
      label: 'Narration voice (macOS say)',
      status: 'warn',
      detail: `voice "${loaded.config.voice.name}" is not installed`,
      fix: 'Pick an installed voice (`say -v ?`) and set it in .showtime/config.json, or download it in System Settings → Accessibility → Spoken Content.',
    })
  } else {
    add({
      id: 'say',
      label: 'Narration voice (macOS say)',
      status: 'ok',
      detail: `${voices.length} voices available`,
    })
  }

  // Only key presence is read from .env; values never enter a result. With both tokens, check the connection.
  loadDotEnv(deps.root, env)
  const missing = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'].filter((k) => !env[k])
  if (missing.length > 0) {
    add({
      id: 'slack',
      label: 'Slack',
      status: 'warn',
      detail: `${missing.join(', ')} not set`,
      fix: 'Follow docs/slack-setup.md, then add the tokens to .env (never commit it).',
    })
  } else if (
    !(env.SLACK_APP_TOKEN as string).startsWith('xapp-') ||
    !(env.SLACK_BOT_TOKEN as string).startsWith('xoxb-')
  ) {
    add({
      id: 'slack',
      label: 'Slack',
      status: 'fail',
      detail: 'a token has the wrong shape (bot tokens start xoxb-, app tokens xapp-)',
      fix: 'Copy the Bot User OAuth Token and the App-Level Token again (docs/slack-setup.md).',
    })
  } else {
    const r = await (deps.slackAuth ?? slackAuthTest)(env.SLACK_BOT_TOKEN as string)
    add(
      r.ok
        ? {id: 'slack', label: 'Slack', status: 'ok', detail: r.detail}
        : {
            id: 'slack',
            label: 'Slack',
            status: 'fail',
            detail: r.detail,
            fix: 'Reinstall the app to the workspace and copy the new Bot User OAuth Token into .env.',
          },
    )
  }

  return checks
}

export const hasFailures = (checks: Check[]) => checks.some((c) => c.status === 'fail')
