import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {execa} from 'execa'

import {type Clip, narrate} from '../narrate/narrate.js'
import type {Tts} from '../narrate/tts.js'
import type {Recording} from '../record/record.js'
import {showDir} from '../script/files.js'
import type {DemoScript} from '../script/schema.js'
import {cardSegmentArgs, concatArgs, previewArgs, stepSegmentArgs, stepStillArgs} from './ffmpeg-cmd.js'
import {renderStills} from './stills.js'
import {backgroundHtml, endCardHtml, overlayHtml, titleCardHtml} from './templates.js'

const LEAD = 0.6
const TAIL = 1
/** Long enough to read the screen, short enough to hold attention: 7 steps land near 60 s. */
const MIN_STEP = 7.5
const MIN_CARD = 5

export interface RenderResult {
  mp4: string
  preview: string
  seconds: number
  hash: string
  reused: boolean
  stills: string[]
}

export interface RenderOptions {
  root: string
  script: DemoScript
  tts: Tts
  ffmpeg: string
  /** Only write the review stills; skip narration and video. */
  stillsOnly?: boolean
  force?: boolean
  /** Probe override for tests. */
  seconds?: (file: string) => Promise<number>
}

const sha = (...parts: Array<string | Uint8Array>) => {
  const h = crypto.createHash('sha256')
  for (const p of parts) h.update(p)
  return h.digest('hex')
}

export const LEAD_SECONDS = LEAD
export const cardSeconds = (clip: Clip, isStep: boolean) =>
  Math.max(isStep ? MIN_STEP : MIN_CARD, LEAD + clip.seconds + TAIL)

function loadRecording(root: string, story: string): {dir: string; rec: Recording} {
  const dir = showDir(root, story)
  const file = path.join(dir, 'recording.json')
  if (!fs.existsSync(file))
    throw new Error(`No recording for ${story}. Run \`agentia showtime record ${story}\` first.`)
  const rec = JSON.parse(fs.readFileSync(file, 'utf8')) as Recording
  if (rec.failed.length)
    throw new Error(`The recording has failed steps (${rec.failed.join(', ')}). Fix them and record again.`)
  return {dir, rec}
}

async function ff(bin: string, args: string[]) {
  const r = await execa(bin, args, {reject: false, timeout: 10 * 60_000})
  if (r.failed) throw new Error(`ffmpeg failed: ${String(r.stderr).split('\n').slice(-6).join(' | ')}`)
}

/**
 * Narration → cards → ffmpeg. Deterministic: the output hash covers the script, frames, voice and ffmpeg
 * version, and an identical hash reuses the existing video.
 */
export async function renderShow(o: RenderOptions): Promise<RenderResult> {
  const story = o.script.story.name
  const {dir, rec} = loadRecording(o.root, story)
  const work = path.join(dir, 'render')
  const stillsDir = path.join(work, 'stills')
  fs.mkdirSync(stillsDir, {recursive: true})

  const frame = (id: string) => {
    const f = rec.steps.find((s) => s.id === id)?.frame
    if (!f) throw new Error(`No frame for step "${id}"`)
    return path.join(dir, f)
  }

  // Layers: one background, one overlay per step, and the two full cards.
  const bg = path.join(work, 'bg.png')
  const title = path.join(work, 'title.png')
  const end = path.join(work, 'end.png')
  const overlays = o.script.steps.map((s, i) =>
    path.join(work, `overlay-${String(i + 1).padStart(2, '0')}-${s.id}.png`),
  )
  await renderStills([
    {file: bg, html: backgroundHtml()},
    {file: title, html: titleCardHtml(o.script)},
    {file: end, html: endCardHtml(o.script)},
    ...o.script.steps.map((s, i) => ({
      file: overlays[i] as string,
      html: overlayHtml(s.caption, i + 1, o.script.steps.length),
      transparent: true,
    })),
  ])

  const stills: string[] = [title, end]
  for (const [i, s] of o.script.steps.entries()) {
    const out = path.join(stillsDir, `${String(i + 1).padStart(2, '0')}-${s.id}.png`)
    await ff(o.ffmpeg, stepStillArgs({bg, shot: frame(s.id), overlay: overlays[i] as string, out}))
    stills.push(out)
  }
  if (o.stillsOnly) return {mp4: '', preview: '', seconds: 0, hash: '', reused: false, stills}

  const clips = await narrate(o.script, {dir: path.join(work, 'audio'), tts: o.tts, seconds: o.seconds})
  const ffVersion =
    (await execa(o.ffmpeg, ['-version'], {reject: false})).stdout?.toString().split('\n')[0] ?? ''
  const hash = sha(
    JSON.stringify(o.script),
    ffVersion,
    o.tts.name,
    JSON.stringify(clips.map((c) => [c.id, c.text, c.seconds.toFixed(2)])),
    ...o.script.steps.map((s) => fs.readFileSync(frame(s.id))),
    backgroundHtml(),
    titleCardHtml(o.script),
    endCardHtml(o.script),
    ...o.script.steps.map((s, i) => overlayHtml(s.caption, i + 1, o.script.steps.length)),
  )
  const outDir = path.join(dir, 'video')
  const mp4 = path.join(outDir, `${story}.mp4`)
  const preview = path.join(outDir, `${story}-preview.mp4`)
  const meta = path.join(outDir, 'render.json')
  if (!o.force && fs.existsSync(mp4) && fs.existsSync(meta)) {
    const prev = JSON.parse(fs.readFileSync(meta, 'utf8')) as {hash: string; seconds: number}
    if (prev.hash === hash) return {mp4, preview, seconds: prev.seconds, hash, reused: true, stills}
  }
  fs.mkdirSync(outDir, {recursive: true})

  const segDir = path.join(work, 'segments')
  fs.rmSync(segDir, {recursive: true, force: true})
  fs.mkdirSync(segDir, {recursive: true})
  const segments: string[] = []
  let total = 0
  for (const [i, clip] of clips.entries()) {
    const isStep = clip.id !== 'title' && clip.id !== 'end'
    const dur = cardSeconds(clip, isStep)
    total += dur
    const out = path.join(segDir, `${String(i).padStart(2, '0')}-${clip.id}.mp4`)
    if (isStep) {
      const si = i - 1
      await ff(
        o.ffmpeg,
        stepSegmentArgs({
          bg,
          shot: frame(clip.id),
          overlay: overlays[si] as string,
          audio: clip.file,
          out,
          dur,
          lead: LEAD,
        }),
      )
    } else {
      await ff(
        o.ffmpeg,
        cardSegmentArgs({card: clip.id === 'title' ? title : end, audio: clip.file, out, dur, lead: LEAD}),
      )
    }
    segments.push(out)
  }
  const list = path.join(segDir, 'list.txt')
  fs.writeFileSync(list, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n') + '\n')
  await ff(o.ffmpeg, concatArgs(list, mp4))
  await ff(o.ffmpeg, previewArgs(mp4, preview))
  fs.writeFileSync(
    meta,
    `${JSON.stringify({hash, seconds: Math.round(total * 10) / 10, voice: o.tts.name, ffmpeg: ffVersion}, null, 2)}\n`,
  )
  return {mp4, preview, seconds: Math.round(total * 10) / 10, hash, reused: false, stills}
}
