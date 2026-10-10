import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {ROOT_POINTER} from './config.js'

export type SkillTarget = 'agents' | 'claude' | 'cursor'

/** The skill ships inside the plugin package under `skills/showtime`. */
export const SKILL_SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/showtime')

/** Copies the Showtime skill into `<project>/.<target>/skills/showtime`, replacing an older copy. */
export function installSkill(
  project: string,
  target: SkillTarget = 'agents',
  source: string = SKILL_SOURCE,
): string {
  if (!fs.existsSync(path.join(source, 'SKILL.md')))
    throw new Error(`The Showtime skill was not found at ${source}.`)
  const dest = path.join(project, `.${target}`, 'skills', 'showtime')
  fs.rmSync(dest, {recursive: true, force: true})
  fs.cpSync(source, dest, {recursive: true})
  return dest
}

const START = '<!-- showtime:start -->'
const END = '<!-- showtime:end -->'

/** A short, always-in-context pointer. A skill on its own is easy to overlook next to a project's own workflow notes. */
export const INSTRUCTION_BLOCK = `${START}
## Showtime (UAT sign-off)

When a story has been promoted to UAT, or someone asks what happens next, how to get business sign-off, or what the business owner said: load the \`showtime\` skill. It sends the business owner a narrated demo video in Slack (\`agentia showtime run <story>\`, after asking the user) and reads their feedback (\`agentia showtime status <story>\`). Never mark a story approved and never promote on the business owner's behalf.
${END}
`

/** The file a given agent reads: Claude Code reads CLAUDE.md; others read AGENTS.md. */
export const instructionFile = (target: SkillTarget) => (target === 'claude' ? 'CLAUDE.md' : 'AGENTS.md')

/** Adds or refreshes the managed block between its markers. Everything else in the file is left alone. */
export function updateInstructions(project: string, target: SkillTarget): string {
  const file = path.join(project, instructionFile(target))
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const start = current.indexOf(START)
  const end = current.indexOf(END)
  const next =
    start >= 0 && end > start
      ? `${current.slice(0, start)}${INSTRUCTION_BLOCK.trimEnd()}${current.slice(end + END.length)}`
      : `${current}${current && !current.endsWith('\n') ? '\n' : ''}${current ? '\n' : ''}${INSTRUCTION_BLOCK}`
  fs.writeFileSync(file, next)
  return file
}

/** Points a developer's repo at the folder that holds Showtime's state. A no-op when they are the same folder. */
export function writeRootPointer(project: string, showtimeRoot: string): string | undefined {
  if (path.resolve(project) === path.resolve(showtimeRoot)) return undefined
  const file = path.join(project, ROOT_POINTER)
  fs.writeFileSync(file, `${path.resolve(showtimeRoot)}\n`)
  return file
}
