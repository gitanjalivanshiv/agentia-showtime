import fs from 'node:fs'
import path from 'node:path'

/** Loads `.env` from the project root into process.env without overriding values already set. Never logs values. */
export function loadDotEnv(root: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const file = path.join(root, '.env')
  if (!fs.existsSync(file)) return []
  const loaded: string[] = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m || line.trim().startsWith('#')) continue
    const value = (m[2] as string).replace(/^(['"])(.*)\1$/, '$2')
    if (value && env[m[1] as string] === undefined) {
      env[m[1] as string] = value
      loaded.push(m[1] as string)
    }
  }
  return loaded
}
