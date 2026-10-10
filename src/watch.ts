import fs from 'node:fs'
import path from 'node:path'

import type {Copado, Story} from './agentia/copado.js'
import type {ShowtimeConfig} from './config.js'
import {LockBusyError} from './lock.js'
import {PipelineError, runPipeline, type Stages} from './pipeline.js'
import {loadDecision} from './review/store.js'
import {showDir} from './script/files.js'
import {loadShow} from './store/lifecycle.js'

export interface Candidate {
  story: Story
  reason: 'new' | 'new-round'
}

const MAX_ATTEMPTS = 2
/** A story we just wrote a note to changes its last-modified time; give that write a margin before calling it a new round. */
const OWN_WRITE_MARGIN_MS = 30_000

const failureFile = (root: string, story: string) => path.join(showDir(root, story), 'failure.json')
interface Failure {
  attempts: number
  stage: string
  message: string
  at: string
}
const readFailure = (root: string, story: string): Failure | undefined => {
  const f = failureFile(root, story)
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as Failure) : undefined
}

/**
 * Stories to show: named like a Showtime demo, sitting in the UAT environment, and either never shown or
 * changed after the business asked for changes. Nothing that is waiting for a decision or already approved.
 */
export async function findCandidates(
  copado: Pick<Copado, 'listStories'>,
  config: ShowtimeConfig,
  root: string,
): Promise<Candidate[]> {
  const stories = await copado.listStories({title: config.storyPrefix})
  const out: Candidate[] = []
  for (const story of stories) {
    if (!story.title.startsWith(config.storyPrefix)) continue
    if (story.sourceEnvironmentName !== config.uatEnvironment) continue
    if ((readFailure(root, story.name)?.attempts ?? 0) >= MAX_ATTEMPTS) continue
    const state = loadShow(root, story.name)?.state
    if (state === undefined || state === 'detected') out.push({story, reason: 'new'})
    else if (state === 'changes_requested') {
      const d = loadDecision(root, story.name)
      const since = Date.parse(d?.copadoAt ?? d?.at ?? '') + OWN_WRITE_MARGIN_MS
      if (story.lastModifiedDate && Date.parse(story.lastModifiedDate) > since)
        out.push({story, reason: 'new-round'})
    }
  }
  return out
}

export interface WatchOnceResult {
  found: string[]
  ran: string[]
  failed: Array<{story: string; stage: string; message: string}>
  waiting: string[]
}

/** One poll: runs every candidate in turn. A held shared lock means "try again next poll", not a failure. */
export async function watchOnce(o: {
  root: string
  config: ShowtimeConfig
  copado: Pick<Copado, 'listStories'>
  stages: Stages
  log: (l: string) => void
  dryRun?: boolean
  max?: number
}): Promise<WatchOnceResult> {
  const candidates = (await findCandidates(o.copado, o.config, o.root)).slice(0, o.max ?? 5)
  const result: WatchOnceResult = {
    found: candidates.map((c) => c.story.name),
    ran: [],
    failed: [],
    waiting: [],
  }
  for (const c of candidates) {
    const name = c.story.name
    o.log(
      `${name} is in ${o.config.uatEnvironment} (${c.reason === 'new' ? 'new' : 'changed after review'}): "${c.story.title}"`,
    )
    if (o.dryRun) continue
    try {
      await runPipeline(o.stages, name, {progress: o.log})
      fs.rmSync(failureFile(o.root, name), {force: true})
      result.ran.push(name)
    } catch (e) {
      const cause = e instanceof PipelineError ? e.cause : e
      if (cause instanceof LockBusyError) {
        o.log(`${name}: the shared Copado lock is held, will retry on the next poll`)
        result.waiting.push(name)
        continue
      }
      const stage = e instanceof PipelineError ? e.stage : 'unknown'
      const message = e instanceof Error ? e.message : String(e)
      const attempts = (readFailure(o.root, name)?.attempts ?? 0) + 1
      fs.mkdirSync(path.dirname(failureFile(o.root, name)), {recursive: true})
      fs.writeFileSync(
        failureFile(o.root, name),
        `${JSON.stringify({attempts, stage, message, at: new Date().toISOString()} satisfies Failure, null, 2)}\n`,
      )
      o.log(`${name}: ${stage} failed (attempt ${attempts} of ${MAX_ATTEMPTS}): ${message}`)
      result.failed.push({story: name, stage, message})
    }
  }
  return result
}
