import type {DecisionKind} from './payloads.js'

const START = '[Showtime review '
const END = '[/Showtime review]'
/** Copado's limit for the Technical Specifications field is 30000 characters. */
export const FIELD_LIMIT = 30000

export interface NoteInfo {
  kind: DecisionKind
  by: string
  at: Date
  comment?: string
  videoUrl?: string
}

export function formatNote(i: NoteInfo): string {
  const stamp = `${i.at.toISOString().slice(0, 16).replace('T', ' ')} UTC`
  return [
    `${START}${stamp}]`,
    `Decision: ${i.kind === 'approved' ? 'APPROVED' : 'CHANGES REQUESTED'}`,
    `By: ${i.by}`,
    ...(i.comment ? [`Comment: ${i.comment.replace(/\s+/g, ' ').trim()}`] : []),
    ...(i.videoUrl ? [`Video: ${i.videoUrl}`] : []),
    END,
  ].join('\n')
}

/** Appends a note and drops the oldest Showtime notes if the field would overflow. Other text is never touched. */
export function mergeNote(existing: string | undefined, note: string): string {
  let text = `${(existing ?? '').trimEnd()}${existing ? '\n\n' : ''}${note}`
  while (text.length > FIELD_LIMIT) {
    const s = text.indexOf(START)
    const e = s < 0 ? -1 : text.indexOf(END, s)
    if (s < 0 || e < 0 || s >= text.length - note.length) break
    text = `${text.slice(0, s)}${text.slice(e + END.length)}`.replace(/\n{3,}/g, '\n\n').trim()
  }
  return text
}
