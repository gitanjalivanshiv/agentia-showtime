import fs from 'node:fs'
import path from 'node:path'

import {z} from 'zod'

import {CONFIG_DIR} from '../config.js'
import {showDir} from '../script/files.js'

/** Where the review card lives in Slack, so a click can update it. */
const reviewSchema = z.object({
  story: z.string(),
  channel: z.string(),
  ts: z.string(),
  fileId: z.string().optional(),
  videoUrl: z.string().optional(),
  releaseChannel: z.string().optional(),
  sentAt: z.string(),
})
export type ReviewRecord = z.infer<typeof reviewSchema>

const decisionSchema = z.object({
  story: z.string(),
  kind: z.enum(['approved', 'changes_requested']),
  by: z.string(),
  byId: z.string(),
  at: z.string(),
  comment: z.string().optional(),
  /** Whether the note reached the story in Copado. */
  copado: z.enum(['written', 'pending', 'failed']),
  copadoNote: z.string().optional(),
})
export type DecisionRecord = z.infer<typeof decisionSchema>

const file = (root: string, story: string, name: string) => path.join(showDir(root, story), name)

export function saveReview(root: string, r: ReviewRecord): void {
  fs.mkdirSync(showDir(root, r.story), {recursive: true})
  fs.writeFileSync(file(root, r.story, 'review.json'), `${JSON.stringify(r, null, 2)}\n`)
}

export function loadReview(root: string, story: string): ReviewRecord | undefined {
  const f = file(root, story, 'review.json')
  return fs.existsSync(f) ? reviewSchema.parse(JSON.parse(fs.readFileSync(f, 'utf8'))) : undefined
}

export function saveDecision(root: string, d: DecisionRecord): void {
  fs.writeFileSync(file(root, d.story, 'decision.json'), `${JSON.stringify(d, null, 2)}\n`)
}

export function loadDecision(root: string, story: string): DecisionRecord | undefined {
  const f = file(root, story, 'decision.json')
  return fs.existsSync(f) ? decisionSchema.parse(JSON.parse(fs.readFileSync(f, 'utf8'))) : undefined
}

export const feedbackPath = (root: string, story: string) =>
  path.join(root, CONFIG_DIR, 'feedback', `${story}.md`)

/** What the developer's AI agent reads. Newest entry last. */
export function appendFeedback(root: string, d: DecisionRecord, feature: string): string {
  const f = feedbackPath(root, d.story)
  fs.mkdirSync(path.dirname(f), {recursive: true})
  const head = fs.existsSync(f) ? '' : `# Business feedback for ${d.story}: ${feature}\n\n`
  fs.appendFileSync(
    f,
    `${head}## ${d.at} · changes requested by ${d.by}\n\n${d.comment ?? '(no comment)'}\n\n`,
  )
  return f
}
