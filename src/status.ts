import fs from 'node:fs'
import path from 'node:path'

import {CONFIG_DIR} from './config.js'
import {loadReview, loadDecision, type DecisionRecord} from './review/store.js'
import {loadShow, type Show} from './store/lifecycle.js'

/**
 * Lifecycle notes are kept in full in show.json for debugging, but the human views hide the ones that are only
 * identifiers (CRT build number, render hash, Slack channel ID): nothing to read there, and nothing to leak on a screen.
 */
export const isReadableNote = (note: string) => !/^(build|hash|channel)=/.test(note)

export interface ShowStatus {
  story: string
  state: Show['state'] | 'unknown'
  history: Show['history']
  /** Seconds from the story being scripted to the decision, when there is one. */
  secondsToDecision?: number
  decision?: Pick<DecisionRecord, 'kind' | 'by' | 'at' | 'comment' | 'copado'>
  videoUrl?: string
}

export function showStatus(root: string, story: string): ShowStatus {
  const show = loadShow(root, story)
  const decision = loadDecision(root, story)
  const review = loadReview(root, story)
  const first = show?.history.find((h) => h.state === 'scripted')?.at
  const last = decision?.at
  return {
    story,
    state: show?.state ?? 'unknown',
    history: show?.history ?? [],
    ...(first && last ? {secondsToDecision: Math.round((Date.parse(last) - Date.parse(first)) / 1000)} : {}),
    ...(decision
      ? {
          decision: {
            kind: decision.kind,
            by: decision.by,
            at: decision.at,
            comment: decision.comment,
            copado: decision.copado,
          },
        }
      : {}),
    ...(review?.videoUrl ? {videoUrl: review.videoUrl} : {}),
  }
}

export function listStories(root: string): string[] {
  const dir = path.join(root, CONFIG_DIR, 'shows')
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((d) => fs.statSync(path.join(dir, d)).isDirectory())
        .sort()
    : []
}
