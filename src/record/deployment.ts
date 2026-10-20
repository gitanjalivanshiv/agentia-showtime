import type {Copado, Promotion} from '../agentia/copado.js'

/**
 * `agentia cicd work submit --deploy` returns as soon as the promotion starts; the deployment keeps running in Copado.
 * A story can therefore be "in UAT" before its metadata is. Recording waits for the newest promotion into the UAT
 * environment to finish, so the robot never films the old behaviour. Read-only: it only lists promotions.
 */

export type DeploymentState =
  {state: 'none'} | {state: 'done' | 'running' | 'failed'; promotion: string; status: string}

const FAILED = /error|fail|cancel|conflict|rolled ?back/i
const DONE = /^(completed|validated)$/i

export function deploymentState(promotions: Promotion[], uatEnvironment: string): DeploymentState {
  const latest = promotions
    .filter((p) => p.destinationEnvironmentName === uatEnvironment && !p.isBackPromotion)
    .sort((a, b) => (b.createdDate ?? '').localeCompare(a.createdDate ?? ''))[0]
  if (!latest) return {state: 'none'}
  const status = latest.status ?? 'unknown'
  const state = FAILED.test(status) ? 'failed' : DONE.test(status) ? 'done' : 'running'
  return {state, promotion: latest.name, status}
}

export interface WaitOptions {
  say?: (line: string) => void
  timeoutMs?: number
  intervalMs?: number
  sleep?: (ms: number) => Promise<void>
}

/** Resolves when the story's newest promotion into UAT is finished (or there is none). Throws if it failed or timed out. */
export async function waitForDeployment(
  copado: Copado,
  story: string,
  uatEnvironment: string,
  o: WaitOptions = {},
): Promise<DeploymentState> {
  const timeoutMs = o.timeoutMs ?? 20 * 60 * 1000
  const intervalMs = o.intervalMs ?? 10_000
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let waited = 0
  let told = false
  for (;;) {
    const d = deploymentState(await copado.storyPromotions(story), uatEnvironment)
    if (d.state === 'none' || d.state === 'done') return d
    if (d.state === 'failed')
      throw new Error(
        `The promotion of ${story} to ${uatEnvironment} did not finish (status "${d.status}"). Nothing was recorded.`,
      )
    if (waited >= timeoutMs)
      throw new Error(
        `The promotion of ${story} to ${uatEnvironment} is still "${d.status}" after ${Math.round(waited / 60_000)} min. Nothing was recorded.`,
      )
    if (!told) {
      o.say?.(`Waiting for the deployment to ${uatEnvironment} to finish…`)
      told = true
    }
    await sleep(intervalMs)
    waited += intervalMs
  }
}
