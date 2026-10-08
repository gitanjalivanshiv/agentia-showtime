import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Shared playground lock (PLAYGROUND_RULES.md): one line, `<project>: <action> started <ISO time>`. */
export const lockFile = (env: NodeJS.ProcessEnv = process.env) =>
  env.SHOWTIME_LOCK_FILE ?? path.join(os.homedir(), 'hackathon', '.org-busy')

export class LockBusyError extends Error {
  override readonly name = 'LockBusyError'
  constructor(readonly contents: string) {
    super(
      `The shared Copado lock is held: "${contents.trim()}". Ask the user before continuing; do not delete it.`,
    )
  }
}

/**
 * Runs `fn` while holding the lock and always releases it, including on failure.
 * Refuses to start when someone else holds it: the caller must ask the user (rules, "The shared lock").
 */
export async function withOrgLock<T>(
  action: string,
  fn: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): Promise<T> {
  const file = lockFile(env)
  const line = `showtime: ${action} started ${now().toISOString()}\n`
  try {
    fs.writeFileSync(file, line, {flag: 'wx'})
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new LockBusyError(fs.readFileSync(file, 'utf8'))
    throw e
  }
  try {
    return await fn()
  } finally {
    fs.rmSync(file, {force: true})
  }
}
