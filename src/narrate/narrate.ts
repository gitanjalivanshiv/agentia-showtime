import fs from 'node:fs'
import path from 'node:path'

import type {DemoScript} from '../script/schema.js'
import {audioSeconds, type Tts} from './tts.js'

export interface Clip {
  /** `title`, a step id, or `end`. */
  id: string
  text: string
  file: string
  seconds: number
}

/** Fixed lines for the title and end cards. Warm and short, like the step narration. */
export function introLine(script: DemoScript): string {
  return `Here's what's new: ${script.feature}. Take a look, and tell us what you think.`
}
export const OUTRO_LINE = "That's it. Approve in Slack if it looks right, or ask for changes."

export interface NarrateOptions {
  dir: string
  tts: Tts
  /** Duration probe; injectable for tests. */
  seconds?: (file: string) => Promise<number>
}

/** One audio clip per card. Existing clips for identical text are reused so re-renders are cheap and stable. */
export async function narrate(script: DemoScript, o: NarrateOptions): Promise<Clip[]> {
  fs.mkdirSync(o.dir, {recursive: true})
  const lines = [
    {id: 'title', text: introLine(script)},
    ...script.steps.map((s) => ({id: s.id, text: s.narration})),
    {id: 'end', text: OUTRO_LINE},
  ]
  const probe = o.seconds ?? ((f: string) => audioSeconds(f))
  const clips: Clip[] = []
  for (const [i, line] of lines.entries()) {
    const file = path.join(o.dir, `${String(i).padStart(2, '0')}-${line.id}.aiff`)
    const memo = `${file}.txt`
    const cached =
      fs.existsSync(file) &&
      fs.existsSync(memo) &&
      fs.readFileSync(memo, 'utf8') === `${o.tts.name}\n${line.text}`
    if (!cached) {
      await o.tts.synth(line.text, file)
      fs.writeFileSync(memo, `${o.tts.name}\n${line.text}`)
    }
    clips.push({...line, file, seconds: await probe(file)})
  }
  return clips
}
