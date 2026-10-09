import type {Copado} from '../agentia/copado.js'
import {LockBusyError, withOrgLock} from '../lock.js'
import {transition, loadShow} from '../store/lifecycle.js'
import {mergeNote, formatNote} from './note.js'
import {
  type DecisionKind,
  decidedBlocks,
  decidedFallback,
  type ReviewInfo,
  releaseBlocks,
  releaseFallback,
} from './payloads.js'
import type {SlackGateway} from './slack.js'
import {appendFeedback, type DecisionRecord, loadDecision, loadReview, saveDecision} from './store.js'

export interface DecideDeps {
  root: string
  gateway: SlackGateway
  copado: Pick<Copado, 'appendStoryNote'>
  info: (story: string) => ReviewInfo
  approverIds?: string[]
  now?: () => Date
  /** Waits between lock retries; injectable for tests. */
  sleep?: (ms: number) => Promise<void>
  env?: NodeJS.ProcessEnv
}

export type DecideOutcome =
  | {status: 'recorded'; decision: DecisionRecord}
  | {status: 'already-decided'; decision: DecisionRecord}
  | {status: 'not-allowed'}
  | {status: 'not-sent'}

export interface DecideInput {
  story: string
  kind: DecisionKind
  userId: string
  comment?: string
}

/** Writes the decision's note to the story in Copado, waiting briefly if another project holds the lock. */
export async function writeBack(
  deps: Pick<DecideDeps, 'copado' | 'sleep' | 'env'>,
  story: string,
  note: string,
): Promise<'written' | 'pending' | 'failed'> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await withOrgLock(
        `write review note to ${story}`,
        () => deps.copado.appendStoryNote(story, (existing) => mergeNote(existing, note)),
        deps.env,
      )
      return 'written'
    } catch (e) {
      if (!(e instanceof LockBusyError)) return 'failed'
      if (attempt < 3) await sleep(5000)
    }
  }
  return 'pending'
}

/**
 * One business decision. Local record first (it is the source of truth), then Slack, then Copado.
 * A Copado problem never undoes the decision. Never promotes or deploys anything.
 */
export async function applyDecision(deps: DecideDeps, input: DecideInput): Promise<DecideOutcome> {
  const now = deps.now ?? (() => new Date())
  const review = loadReview(deps.root, input.story)
  const show = loadShow(deps.root, input.story)
  if (!review || show?.state === undefined) return {status: 'not-sent'}
  const existing = loadDecision(deps.root, input.story)
  if (show.state !== 'sent') {
    return existing ? {status: 'already-decided', decision: existing} : {status: 'not-sent'}
  }
  if (deps.approverIds?.length && !deps.approverIds.includes(input.userId)) return {status: 'not-allowed'}

  const at = now()
  const by = await deps.gateway.displayName(input.userId)
  const info = deps.info(input.story)
  const base: DecisionRecord = {
    story: input.story,
    kind: input.kind,
    by,
    byId: input.userId,
    at: at.toISOString(),
    ...(input.comment ? {comment: input.comment} : {}),
    copado: 'pending',
  }
  saveDecision(deps.root, base)
  transition(deps.root, input.story, input.kind, `by=${by}`, at)

  const decided = {...info, kind: input.kind, by, at, comment: input.comment}
  await deps.gateway.updateMessage({
    channel: review.channel,
    ts: review.ts,
    blocks: decidedBlocks(decided),
    text: decidedFallback(decided),
  })

  if (input.kind === 'approved') {
    const release = {story: input.story, feature: info.feature, by, at, videoUrl: review.videoUrl}
    if (review.releaseChannel) {
      await deps.gateway.postMessage({
        channel: review.releaseChannel,
        blocks: releaseBlocks(release),
        text: releaseFallback(release),
      })
    }
  } else {
    appendFeedback(deps.root, base, info.feature)
  }

  const note = formatNote({kind: input.kind, by, at, comment: input.comment, videoUrl: review.videoUrl})
  const copado = await writeBack(deps, input.story, note)
  const final: DecisionRecord = {...base, copado, copadoNote: note}
  saveDecision(deps.root, final)
  if (copado !== 'written') {
    await deps.gateway.postMessage({
      channel: review.channel,
      threadTs: review.ts,
      text: `Your decision is saved. The note on the Copado story is ${copado === 'pending' ? 'waiting for the shared lock' : 'not written yet (see agentia showtime status)'}.`,
      blocks: [],
    })
  }
  return {status: 'recorded', decision: final}
}
