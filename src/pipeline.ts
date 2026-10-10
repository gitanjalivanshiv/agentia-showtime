import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {WebClient} from '@slack/web-api'

import type {Copado} from './agentia/copado.js'
import type {ShowtimeConfig} from './config.js'
import {loadDotEnv} from './env.js'
import {renderShow} from './edit/render.js'
import {chooseTts} from './narrate/tts.js'
import {getFrontdoorUrl} from './record/frontdoor.js'
import {type Recording, recordShow} from './record/record.js'
import {withOrgLock} from './lock.js'
import {sendReview} from './review/send.js'
import {WebGateway, type SlackGateway, type WebClientLike} from './review/slack.js'
import {readScript, scriptPath, writeScript} from './script/files.js'
import {generateScript, parseScriptYaml} from './script/generate.js'
import {type DemoScript, estimateSeconds} from './script/schema.js'
import {transition} from './store/lifecycle.js'
import {resolveFfmpeg} from './util/ffmpeg.js'

/** The four stages of a show, as reusable functions. `run`, `watch`, the MCP server and the single commands all call these. */

export interface StageContext {
  root: string
  config: ShowtimeConfig
  copado: Copado
}

const BUNDLED_FALLBACK = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../examples/demo/script.fallback.yaml',
)

/** Hint for the AI: `--hint`, else `.showtime/hints/<story>.txt`, else the config's `scriptHint`. */
export function resolveHint(
  root: string,
  config: ShowtimeConfig,
  story: string,
  flag?: string,
): string | undefined {
  if (flag) return flag
  const file = path.join(root, '.showtime', 'hints', `${story}.txt`)
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim() || undefined
  return config.scriptHint
}

export class PipelineError extends Error {
  override readonly name = 'PipelineError'
  constructor(
    readonly stage: StageName,
    message: string,
    cause?: unknown,
  ) {
    super(message, {cause})
  }
}

export type StageName = 'script' | 'record' | 'render' | 'send'

export interface ScriptOptions {
  noAi?: boolean
  fallback?: string
  hint?: string
  dryRun?: boolean
}
export interface ScriptResult {
  script: DemoScript
  path?: string
  seconds: number
  problems: string[]
}

export async function scriptStory(
  c: StageContext,
  storyId: string,
  o: ScriptOptions = {},
  say: (l: string) => void = () => {},
): Promise<ScriptResult> {
  const story = await c.copado.getStory(storyId)
  let script: DemoScript | undefined
  let problems: string[] = []
  if (!o.noAi) {
    say('Asking Copado AI for a demo script…')
    const r = await generateScript(
      story,
      (p) => c.copado.ask('plan', p),
      c.config.uatEnvironment,
      resolveHint(c.root, c.config, story.name, o.hint),
    )
    script = r.script
    problems = r.problems
    if (!script) say(`Copado AI's answer was not usable (${problems.at(-1)}). Trying the fallback.`)
  }
  if (!script) {
    const file = o.fallback ?? (fs.existsSync(BUNDLED_FALLBACK) ? BUNDLED_FALLBACK : undefined)
    if (!file)
      throw new PipelineError('script', 'No usable AI script and no fallback file. Pass --fallback <file>.')
    const fb = parseScriptYaml(fs.readFileSync(file, 'utf8'), 'fallback')
    // The bundled fallback only fits its own story; any other story needs the user's own file.
    if (!o.fallback && fb.story.title !== story.title) {
      throw new PipelineError(
        'script',
        `The bundled fallback is for "${fb.story.title}", not "${story.title}". Pass --fallback <file>.`,
      )
    }
    script = {...fb, story: {name: story.name, title: story.title}}
  }
  const seconds = estimateSeconds(script)
  let written: string | undefined
  if (!o.dryRun) {
    written = writeScript(c.root, script)
    transition(c.root, story.name, 'scripted', `source=${script.source}`)
  }
  return {script, path: written ?? scriptPath(c.root, story.name), seconds, problems}
}

/** Runs the script in UAT with Robotic Testing. Holds the shared org lock for the upload and run. */
export async function recordStory(c: StageContext, story: string): Promise<Recording> {
  if (c.config.crtJobId === undefined)
    throw new PipelineError('record', 'No crtJobId in the config. Run `agentia showtime init --force`.')
  const script = readScript(c.root, story)
  const crtJobId = c.config.crtJobId
  const recording = await withOrgLock(`record ${story} (CRT upload and run)`, () =>
    recordShow({
      root: c.root,
      script,
      copado: c.copado,
      crtProjectId: c.config.crtProjectId,
      crtJobId,
      frontdoor: () => getFrontdoorUrl(c.config.sfAlias),
    }),
  )
  if (recording.failed.length === 0)
    transition(c.root, story, 'recorded', `build=${recording.buildId ?? '?'}`)
  return recording
}

export async function renderStory(
  c: StageContext,
  story: string,
  o: {stillsOnly?: boolean; force?: boolean} = {},
) {
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw new PipelineError('render', 'ffmpeg was not found. Run `agentia showtime doctor`.')
  const script = readScript(c.root, story)
  const tts = await chooseTts(c.config.voice, ffmpeg.path)
  const result = await renderShow({
    root: c.root,
    script,
    tts,
    ffmpeg: ffmpeg.path,
    stillsOnly: o.stillsOnly,
    force: o.force,
  })
  if (!o.stillsOnly && !result.reused) {
    transition(c.root, story, 'narrated', `voice=${c.config.voice.name}`)
    transition(c.root, story, 'rendered', `hash=${result.hash.slice(0, 12)}`)
  }
  return result
}

export function slackGateway(root: string): SlackGateway {
  loadDotEnv(root)
  const token = process.env.SLACK_BOT_TOKEN
  if (!token)
    throw new PipelineError(
      'send',
      'SLACK_BOT_TOKEN is not set. Follow docs/slack-setup.md, then add it to .env.',
    )
  return new WebGateway(new WebClient(token) as unknown as WebClientLike)
}

export async function sendStory(
  c: StageContext,
  story: string,
  gateway: SlackGateway = slackGateway(c.root),
) {
  const script = readScript(c.root, story)
  return sendReview({
    root: c.root,
    script,
    gateway,
    ownersChannel: c.config.slack.ownersChannel,
    releaseChannel: c.config.slack.releaseChannel,
    uatUrl: c.config.uatUrl,
  })
}

/** Stage functions as a bundle, so the sequencing logic can be tested without Copado, UAT or Slack. */
export interface Stages {
  script(story: string): Promise<{detail: string}>
  record(story: string): Promise<{detail: string}>
  render(story: string): Promise<{detail: string}>
  send(story: string): Promise<{detail: string}>
}

export interface RunOptions {
  /** Skip the Slack post (for example while testing the recording and video). */
  skipSend?: boolean
  /** Start from this stage, reusing earlier results already on disk. */
  from?: StageName
  progress?: (line: string) => void
}

export interface RunResult {
  story: string
  stages: Array<{stage: StageName; detail: string; seconds: number}>
}

const ORDER: StageName[] = ['script', 'record', 'render', 'send']

/** script → record → render → send, with a progress line per stage. Stops at the first stage that fails. */
export async function runPipeline(stages: Stages, story: string, o: RunOptions = {}): Promise<RunResult> {
  const say = o.progress ?? (() => {})
  const todo = ORDER.slice(ORDER.indexOf(o.from ?? 'script')).filter((s) => !(s === 'send' && o.skipSend))
  const out: RunResult['stages'] = []
  for (const stage of todo) {
    const n = ORDER.indexOf(stage) + 1
    say(`[${n}/4] ${stage}…`)
    const t0 = Date.now()
    try {
      const {detail} = await stages[stage](story)
      const seconds = Math.round((Date.now() - t0) / 100) / 10
      out.push({stage, detail, seconds})
      say(`[${n}/4] ${stage} ✓ ${detail} (${seconds} s)`)
    } catch (e) {
      if (e instanceof PipelineError) throw e
      throw new PipelineError(stage, e instanceof Error ? e.message : String(e), e)
    }
  }
  return {story, stages: out}
}

export function realStages(
  c: StageContext,
  o: {
    noAi?: boolean
    fallback?: string
    hint?: string
    gateway?: SlackGateway
    say?: (l: string) => void
  } = {},
): Stages {
  return {
    script: async (story) => {
      const r = await scriptStory(c, story, {noAi: o.noAi, fallback: o.fallback, hint: o.hint}, o.say)
      return {detail: `${r.script.steps.length} steps, ${r.script.source}`}
    },
    record: async (story) => {
      const r = await recordStory(c, story)
      if (r.failed.length)
        throw new PipelineError(
          'record',
          `${r.failed.length} step(s) failed in UAT: ${r.failed.join(', ')}. See .showtime/shows/${story}/artifacts.zip (log.html).`,
        )
      return {detail: `${r.steps.length} screens`}
    },
    render: async (story) => {
      const r = await renderStory(c, story)
      return {detail: `${r.seconds} s video${r.reused ? ' (unchanged)' : ''}`}
    },
    send: async (story) => {
      const r = await sendStory(c, story, o.gateway)
      return {detail: `sent to ${c.config.slack.ownersChannel} (${r.ts})`}
    },
  }
}
