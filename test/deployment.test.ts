import {describe, expect, it} from 'vitest'

import type {Copado, Promotion} from '../src/agentia/copado.js'
import {deploymentState, waitForDeployment} from '../src/record/deployment.js'

const promo = (name: string, status: string, createdDate: string, dest = 'UAT'): Promotion => ({
  name,
  status,
  createdDate,
  destinationEnvironmentName: dest,
  isBackPromotion: false,
})

/** A Copado whose promotion list changes on every call. */
const copadoReturning = (...lists: Promotion[][]) => {
  let i = 0
  return {storyPromotions: async () => lists[Math.min(i++, lists.length - 1)]} as unknown as Copado
}

describe('deploymentState', () => {
  it('reads the newest promotion into UAT, ignoring other environments and older validations', () => {
    const list = [
      promo('P1', 'Validated', '2026-10-10T10:00:00Z'),
      promo('P2', 'In Progress', '2026-10-20T15:28:57Z'),
      promo('P3', 'Completed', '2026-10-21T00:00:00Z', 'PROD'),
    ]
    expect(deploymentState(list, 'UAT')).toEqual({state: 'running', promotion: 'P2', status: 'In Progress'})
  })

  it('is done when completed, failed on errors, none without a promotion', () => {
    expect(deploymentState([promo('P', 'Completed', 'x')], 'UAT').state).toBe('done')
    expect(deploymentState([promo('P', 'Completed with errors', 'x')], 'UAT').state).toBe('failed')
    expect(deploymentState([promo('P', 'Cancelled', 'x')], 'UAT').state).toBe('failed')
    expect(deploymentState([], 'UAT').state).toBe('none')
  })
})

describe('waitForDeployment', () => {
  const noSleep = async () => {}

  it('waits while the promotion runs and says so once', async () => {
    const lines: string[] = []
    const copado = copadoReturning(
      [promo('P2', 'In Progress', 'b')],
      [promo('P2', 'In Progress', 'b')],
      [promo('P2', 'Completed', 'b')],
    )
    const d = await waitForDeployment(copado, 'US-1', 'UAT', {say: (l) => lines.push(l), sleep: noSleep})
    expect(d).toMatchObject({state: 'done', promotion: 'P2'})
    expect(lines).toEqual(['Waiting for the deployment to UAT to finish…'])
  })

  it('refuses to record after a failed promotion or a timeout', async () => {
    await expect(
      waitForDeployment(copadoReturning([promo('P', 'Completed with errors', 'b')]), 'US-1', 'UAT', {
        sleep: noSleep,
      }),
    ).rejects.toThrow(/did not finish/)
    await expect(
      waitForDeployment(copadoReturning([promo('P', 'In Progress', 'b')]), 'US-1', 'UAT', {
        sleep: noSleep,
        timeoutMs: 30_000,
        intervalMs: 10_000,
      }),
    ).rejects.toThrow(/still "In Progress"/)
  })
})
