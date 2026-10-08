import fs from 'node:fs'
import path from 'node:path'

import {z} from 'zod'

import {showDir} from '../script/files.js'

/** detected → scripted → recorded → narrated → rendered → sent → approved | changes_requested → announced */
export const STATES = [
  'detected',
  'scripted',
  'recorded',
  'narrated',
  'rendered',
  'sent',
  'approved',
  'changes_requested',
  'announced',
] as const
export type ShowState = (typeof STATES)[number]

const FORWARD: Record<ShowState, ShowState[]> = {
  detected: ['scripted'],
  // Re-running a stage is allowed: scripts get re-generated, videos get re-rendered.
  scripted: ['scripted', 'recorded'],
  recorded: ['scripted', 'recorded', 'narrated'],
  narrated: ['scripted', 'recorded', 'narrated', 'rendered'],
  rendered: ['scripted', 'recorded', 'narrated', 'rendered', 'sent'],
  sent: ['scripted', 'recorded', 'narrated', 'rendered', 'sent', 'approved', 'changes_requested'],
  approved: ['announced'],
  // After changes are requested the developer fixes the story and a new round starts.
  changes_requested: ['scripted', 'recorded', 'rendered', 'sent'],
  announced: [],
}

export const canMove = (from: ShowState, to: ShowState) => FORWARD[from].includes(to)

const showSchema = z.object({
  story: z.string(),
  state: z.enum(STATES),
  history: z.array(z.object({state: z.enum(STATES), at: z.string(), note: z.string().optional()})),
})
export type Show = z.infer<typeof showSchema>

const showFile = (root: string, story: string) => path.join(showDir(root, story), 'show.json')

export function loadShow(root: string, story: string): Show | undefined {
  const file = showFile(root, story)
  if (!fs.existsSync(file)) return undefined
  return showSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
}

/** Records a transition with its time so the deck can show a real timeline. Throws on an illegal move. */
export function transition(
  root: string,
  story: string,
  to: ShowState,
  note?: string,
  now = new Date(),
): Show {
  const current = loadShow(root, story) ?? {
    story,
    state: 'detected' as ShowState,
    history: [{state: 'detected' as ShowState, at: now.toISOString()}],
  }
  if (!canMove(current.state, to)) throw new Error(`Cannot move ${story} from ${current.state} to ${to}`)
  const next: Show = {
    story,
    state: to,
    history: [...current.history, {state: to, at: now.toISOString(), ...(note ? {note} : {})}],
  }
  fs.mkdirSync(path.dirname(showFile(root, story)), {recursive: true})
  fs.writeFileSync(showFile(root, story), `${JSON.stringify(next, null, 2)}\n`)
  return next
}
