import bolt from '@slack/bolt'

import type {Copado} from '../agentia/copado.js'
import type {ShowtimeConfig} from '../config.js'
import {readScript} from '../script/files.js'
import {applyDecision, type DecideDeps, type DecideOutcome} from './decide.js'
import {ACTIONS, feedbackModal, MODAL_ID, type ReviewInfo} from './payloads.js'
import {renderedVideo, reviewInfo} from './send.js'
import {loadReview} from './store.js'
import {WebGateway, type WebClientLike, type SlackGateway} from './slack.js'

export interface Hub {
  stop(): Promise<void>
}

interface HubOptions {
  root: string
  config: ShowtimeConfig
  copado: Copado
  botToken: string
  appToken: string
  log: (line: string) => void
}

const REPLY: Record<'already-decided' | 'not-allowed' | 'not-sent', string> = {
  'already-decided': 'This review already has a decision. To start a new round, send the demo again.',
  'not-allowed': 'Only the named approvers can decide on this review.',
  'not-sent': 'I could not find this review. Send the demo again with `agentia showtime send`.',
}

/** What a button click carries: which story, who clicked, where. Narrowed from Bolt's loosely typed payloads. */
interface ClickBody {
  user: {id: string}
  channel?: {id: string}
  trigger_id?: string
  actions?: Array<{value?: string}>
}
interface ViewBody {
  user: {id: string}
  view: {private_metadata: string; state: {values: Record<string, Record<string, {value?: string | null}>>}}
}

/** Slack Socket Mode listener: buttons, the "request changes" modal, and nothing else. */
export async function startHub(o: HubOptions): Promise<Hub> {
  const app = new bolt.App({
    token: o.botToken,
    appToken: o.appToken,
    socketMode: true,
    logLevel: bolt.LogLevel.WARN,
  })
  const gateway: SlackGateway = new WebGateway(app.client as unknown as WebClientLike)

  const info = (story: string): ReviewInfo => {
    const script = readScript(o.root, story)
    return reviewInfo(script, renderedVideo(o.root, story).seconds, o.config.uatUrl)
  }
  const deps: DecideDeps = {
    root: o.root,
    gateway,
    copado: o.copado,
    info,
    approverIds: o.config.slack.approverIds,
  }

  const reply = async (channel: string | undefined, user: string, out: DecideOutcome) => {
    if (out.status !== 'recorded' && channel)
      await gateway.postEphemeral({channel, user, text: REPLY[out.status]})
  }
  const allowed = (user: string) =>
    !o.config.slack.approverIds?.length || o.config.slack.approverIds.includes(user)

  app.action(ACTIONS.approve, async ({ack, body}) => {
    await ack()
    const b = body as unknown as ClickBody
    const story = b.actions?.[0]?.value
    if (!story) return
    o.log(`approve ${story}`)
    await reply(
      b.channel?.id,
      b.user.id,
      await applyDecision(deps, {story, kind: 'approved', userId: b.user.id}),
    )
  })

  app.action(ACTIONS.changes, async ({ack, body}) => {
    const b = body as unknown as ClickBody
    const story = b.actions?.[0]?.value
    if (!story || !b.trigger_id) return void (await ack())
    if (!allowed(b.user.id) && b.channel) {
      await ack()
      return reply(b.channel.id, b.user.id, {status: 'not-allowed'})
    }
    // Slack gives 3 seconds to open the modal: build it first, then acknowledge and open at the same time.
    const view = feedbackModal(story, info(story).feature)
    try {
      await Promise.all([ack(), gateway.openModal({triggerId: b.trigger_id, view})])
    } catch (e) {
      o.log(`could not open the modal: ${e instanceof Error ? e.message : String(e)}`)
      if (b.channel)
        await gateway.postEphemeral({
          channel: b.channel.id,
          user: b.user.id,
          text: 'Slack was too slow to open the form. Please click "Request changes" again.',
        })
    }
  })

  // The "Open in UAT" button is a link; Slack still sends an event that must be acknowledged.
  app.action(ACTIONS.openUat, async ({ack}) => {
    await ack()
  })

  app.view(MODAL_ID, async ({ack, body}) => {
    await ack()
    const b = body as unknown as ViewBody
    const story = b.view.private_metadata
    const comment = b.view.state.values.comment_block?.comment?.value?.trim() ?? ''
    o.log(`changes requested ${story}`)
    const out = await applyDecision(deps, {
      story,
      kind: 'changes_requested',
      userId: b.user.id,
      comment: comment || undefined,
    })
    await reply(loadReview(o.root, story)?.channel, b.user.id, out)
  })

  await app.start()
  // Warm the HTTPS connection so the first click is as fast as the rest.
  await app.client.auth.test().catch(() => undefined)
  o.log('Review Hub connected. Waiting for clicks. Press Ctrl+C to stop.')
  return {
    stop: async () => {
      await app.stop()
    },
  }
}
