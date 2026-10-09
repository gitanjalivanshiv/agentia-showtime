import fs from 'node:fs'
import path from 'node:path'

import type {DemoScript} from '../script/schema.js'
import {showDir} from '../script/files.js'
import {transition} from '../store/lifecycle.js'
import {reviewBlocks, reviewFallback, type ReviewInfo} from './payloads.js'
import type {SlackGateway} from './slack.js'
import {loadDecision, saveReview, type ReviewRecord} from './store.js'

export interface SendOptions {
  root: string
  script: DemoScript
  gateway: SlackGateway
  ownersChannel: string
  releaseChannel: string
  uatUrl?: string
  now?: () => Date
}

export const reviewInfo = (script: DemoScript, seconds: number, uatUrl?: string): ReviewInfo => ({
  story: script.story.name,
  feature: script.feature,
  summary: script.summary,
  seconds,
  ...(uatUrl ? {uatUrl} : {}),
})

export function renderedVideo(root: string, story: string): {mp4: string; seconds: number} {
  const dir = path.join(showDir(root, story), 'video')
  const mp4 = path.join(dir, `${story}.mp4`)
  const meta = path.join(dir, 'render.json')
  if (!fs.existsSync(mp4) || !fs.existsSync(meta))
    throw new Error(`No video for ${story}. Run \`agentia showtime render ${story}\` first.`)
  return {mp4, seconds: (JSON.parse(fs.readFileSync(meta, 'utf8')) as {seconds: number}).seconds}
}

/** Upload the video (it plays inline), then post the review card with its buttons right under it. */
export async function sendReview(o: SendOptions): Promise<ReviewRecord> {
  const story = o.script.story.name
  const now = o.now ?? (() => new Date())
  const {mp4, seconds} = renderedVideo(o.root, story)
  const info = reviewInfo(o.script, seconds, o.uatUrl)
  const channel = await o.gateway.resolveChannel(o.ownersChannel)
  const releaseChannel = await o.gateway.resolveChannel(o.releaseChannel)

  // A new round: keep the previous decision as history instead of overwriting it.
  const previous = loadDecision(o.root, story)
  if (previous) {
    const dir = path.join(showDir(o.root, story), 'history')
    fs.mkdirSync(dir, {recursive: true})
    fs.renameSync(
      path.join(showDir(o.root, story), 'decision.json'),
      path.join(dir, `decision-${previous.at.replace(/[:.]/g, '-')}.json`),
    )
  }

  const upload = await o.gateway.uploadVideo({
    channel,
    file: mp4,
    title: `${o.script.feature} (${story})`,
    comment: `🎬 ${o.script.feature}: a ${Math.round(seconds)}-second demo`,
  })
  const posted = await o.gateway.postMessage({
    channel,
    blocks: reviewBlocks(info),
    text: reviewFallback(info),
  })
  const record: ReviewRecord = {
    story,
    channel: posted.channel,
    ts: posted.ts,
    fileId: upload.fileId,
    videoUrl: upload.permalink,
    releaseChannel,
    sentAt: now().toISOString(),
  }
  saveReview(o.root, record)
  transition(o.root, story, 'sent', `channel=${channel}`, now())
  return record
}
