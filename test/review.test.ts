import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {loadDotEnv} from '../src/env.js'
import {applyDecision, writeBack} from '../src/review/decide.js'
import {formatNote, mergeNote, FIELD_LIMIT} from '../src/review/note.js'
import {
  ACTIONS,
  decidedBlocks,
  feedbackModal,
  releaseBlocks,
  reviewBlocks,
  slackTime,
} from '../src/review/payloads.js'
import {reviewInfo, sendReview} from '../src/review/send.js'
import {FakeGateway} from '../src/review/slack.js'
import {feedbackPath, loadDecision, loadReview} from '../src/review/store.js'
import {showDir} from '../src/script/files.js'
import {parseScriptYaml} from '../src/script/generate.js'
import {isReadableNote, showStatus} from '../src/status.js'
import {loadShow, transition} from '../src/store/lifecycle.js'
import {LockBusyError} from '../src/lock.js'

const script = {
  ...parseScriptYaml(
    fs.readFileSync(path.join(import.meta.dirname, '../examples/demo/script.fallback.yaml'), 'utf8'),
  ),
  story: {name: 'US-1', title: 'Showtime Demo – VIP Case Escalation'},
}
const info = reviewInfo(script, 64.9, 'https://example.my.salesforce.com')
const AT = new Date('2026-10-09T14:32:00Z')

describe('Block Kit payloads', () => {
  it('review card', () => expect(reviewBlocks(info)).toMatchSnapshot())
  it('review card without a UAT link has two buttons', () => {
    const actions = reviewBlocks({...info, uatUrl: undefined}).find((b) => b.type === 'actions') as {
      elements: unknown[]
    }
    expect(actions.elements).toHaveLength(2)
  })
  it('approved card replaces the buttons with the outcome', () => {
    const blocks = decidedBlocks({...info, kind: 'approved', by: 'Priya', at: AT})
    expect(blocks.some((b) => b.type === 'actions')).toBe(false)
    expect(blocks).toMatchSnapshot()
  })
  it('changes-requested card quotes the comment', () => {
    const text = JSON.stringify(
      decidedBlocks({
        ...info,
        kind: 'changes_requested',
        by: 'Priya',
        at: AT,
        comment: 'Also escalate for Platinum accounts.\nThanks',
      }),
    )
    expect(text).toContain('Changes requested')
    expect(text).toContain('> Also escalate for Platinum accounts.\\n> Thanks')
  })
  it('release message reminds that promotion is a human step', () => {
    const blocks = releaseBlocks({
      story: 'US-1',
      feature: 'VIP Case Escalation',
      by: 'Priya',
      at: AT,
      videoUrl: 'https://x/y',
    })
    expect(JSON.stringify(blocks)).toContain('Promotion is yours to run')
    expect(blocks).toMatchSnapshot()
  })
  it('feedback modal carries the story in private_metadata', () => {
    expect(feedbackModal('US-1', 'VIP Case Escalation')).toMatchSnapshot()
  })
  it('shows times in the reader time zone with a UTC fallback', () => {
    expect(slackTime(AT)).toBe('<!date^1791556320^{time}|14:32 UTC>')
  })
  it('every button has a stable action id', () => {
    expect(Object.values(ACTIONS)).toEqual(['showtime_approve', 'showtime_changes', 'showtime_open_uat'])
  })
})

describe('Copado note', () => {
  it('formats a readable, dated note', () => {
    expect(
      formatNote({
        kind: 'changes_requested',
        by: 'Priya',
        at: AT,
        comment: 'Also  Platinum\naccounts',
        videoUrl: 'https://x/y',
      }),
    ).toMatchSnapshot()
  })
  it('keeps existing text and appends', () => {
    const merged = mergeNote('Spec: do X', formatNote({kind: 'approved', by: 'P', at: AT}))
    expect(merged.startsWith('Spec: do X\n\n[Showtime review')).toBe(true)
  })
  it('drops the oldest Showtime notes, never other text, when the field overflows', () => {
    const old = formatNote({kind: 'changes_requested', by: 'Old', at: AT, comment: 'x'.repeat(2000)})
    const existing = ['Keep me', ...Array.from({length: 20}, () => old)].join('\n\n')
    const merged = mergeNote(existing, formatNote({kind: 'approved', by: 'New', at: AT}))
    expect(merged.length).toBeLessThanOrEqual(FIELD_LIMIT)
    expect(merged).toContain('Keep me')
    expect(merged).toContain('By: New')
  })
})

describe('send and decide (fake Slack and Copado)', () => {
  let root: string
  let lockDir: string
  let env: NodeJS.ProcessEnv
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'showtime-rev-'))
    lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'showtime-revlock-'))
    env = {SHOWTIME_LOCK_FILE: path.join(lockDir, '.org-busy')}
    const video = path.join(showDir(root, 'US-1'), 'video')
    fs.mkdirSync(video, {recursive: true})
    fs.writeFileSync(path.join(video, 'US-1.mp4'), 'mp4')
    fs.writeFileSync(path.join(video, 'render.json'), JSON.stringify({seconds: 64.9}))
    for (const s of ['scripted', 'recorded', 'narrated', 'rendered'] as const) transition(root, 'US-1', s)
  })
  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
    fs.rmSync(lockDir, {recursive: true, force: true})
  })

  const copadoFake = () => {
    const writes: string[] = []
    return {
      writes,
      copado: {
        appendStoryNote: async (_s: string, merge: (e: string | undefined) => string) =>
          void writes.push(merge('existing text')),
      },
    }
  }
  const send = (gateway = new FakeGateway()) =>
    sendReview({
      root,
      script,
      gateway,
      ownersChannel: '#uat-reviews',
      releaseChannel: '#release',
      now: () => AT,
    }).then((record) => ({gateway, record}))
  const deps = (gateway: FakeGateway, extra: object = {}) => {
    const c = copadoFake()
    return {
      c,
      d: {
        root,
        gateway,
        copado: c.copado,
        info: () => info,
        now: () => new Date('2026-10-09T14:40:00Z'),
        sleep: async () => {},
        env,
        ...extra,
      },
    }
  }

  it('uploads the video first, then posts the card, and records where it lives', async () => {
    const {gateway, record} = await send()
    expect(gateway.calls.map((c) => c.method)).toEqual([
      'resolveChannel',
      'resolveChannel',
      'uploadVideo',
      'postMessage',
    ])
    expect(gateway.of('uploadVideo')[0]).toMatchObject({channel: 'C_UATREVIEWS'})
    expect(loadReview(root, 'US-1')).toMatchObject({
      channel: 'C_UATREVIEWS',
      ts: record.ts,
      releaseChannel: 'C_RELEASE',
    })
    expect(loadShow(root, 'US-1')?.state).toBe('sent')
  })

  it('approve: updates the card, notifies the release channel, writes the note to Copado, never promotes', async () => {
    const {gateway} = await send()
    const {c, d} = deps(gateway)
    const out = await applyDecision(d, {story: 'US-1', kind: 'approved', userId: 'U1'})
    expect(out.status).toBe('recorded')
    expect(gateway.of('updateMessage')).toHaveLength(1)
    expect(JSON.stringify(gateway.of('updateMessage')[0])).toContain('Approved')
    const release = gateway.of('postMessage').at(-1) as {channel: string; text: string}
    expect(release.channel).toBe('C_RELEASE')
    expect(release.text).toContain('Approved for release')
    expect(c.writes[0]).toContain('existing text')
    expect(c.writes[0]).toContain('Decision: APPROVED')
    expect(loadShow(root, 'US-1')?.state).toBe('approved')
    expect(loadDecision(root, 'US-1')).toMatchObject({kind: 'approved', copado: 'written'})
  })

  it('request changes: records the comment for the developer and does not notify the release channel', async () => {
    const {gateway} = await send()
    const {c, d} = deps(gateway)
    await applyDecision(d, {
      story: 'US-1',
      kind: 'changes_requested',
      userId: 'U1',
      comment: 'Also escalate for Platinum accounts.',
    })
    expect(fs.readFileSync(feedbackPath(root, 'US-1'), 'utf8')).toContain(
      'Also escalate for Platinum accounts.',
    )
    expect(gateway.of('postMessage').filter((m) => m.channel === 'C_RELEASE')).toHaveLength(0)
    expect(c.writes[0]).toContain('CHANGES REQUESTED')
    expect(loadShow(root, 'US-1')?.state).toBe('changes_requested')
  })

  it('a second click does nothing', async () => {
    const {gateway} = await send()
    const {d} = deps(gateway)
    await applyDecision(d, {story: 'US-1', kind: 'approved', userId: 'U1'})
    const again = await applyDecision(d, {
      story: 'US-1',
      kind: 'changes_requested',
      userId: 'U2',
      comment: 'no',
    })
    expect(again.status).toBe('already-decided')
    expect(gateway.of('updateMessage')).toHaveLength(1)
  })

  it('only named approvers can decide', async () => {
    const {gateway} = await send()
    const {d} = deps(gateway, {approverIds: ['UBOSS']})
    expect((await applyDecision(d, {story: 'US-1', kind: 'approved', userId: 'UINTRUDER'})).status).toBe(
      'not-allowed',
    )
    expect(loadShow(root, 'US-1')?.state).toBe('sent')
    expect((await applyDecision(d, {story: 'US-1', kind: 'approved', userId: 'UBOSS'})).status).toBe(
      'recorded',
    )
  })

  it('a busy lock leaves the decision saved and the Copado note pending, with the other project lock untouched', async () => {
    const {gateway} = await send()
    fs.writeFileSync(env.SHOWTIME_LOCK_FILE as string, 'mutant: deploy started\n')
    const {c, d} = deps(gateway)
    const out = await applyDecision(d, {story: 'US-1', kind: 'approved', userId: 'U1'})
    expect(out).toMatchObject({status: 'recorded', decision: {copado: 'pending'}})
    expect(c.writes).toHaveLength(0)
    expect(fs.readFileSync(env.SHOWTIME_LOCK_FILE as string, 'utf8')).toBe('mutant: deploy started\n')
    expect(JSON.stringify(gateway.of('postMessage').at(-1))).toContain('waiting for the shared lock')
  })

  it('a Copado failure never undoes the decision', async () => {
    const {gateway} = await send()
    const {d} = deps(gateway, {copado: {appendStoryNote: async () => Promise.reject(new Error('boom'))}})
    const out = await applyDecision(d, {story: 'US-1', kind: 'approved', userId: 'U1'})
    expect(out).toMatchObject({status: 'recorded', decision: {copado: 'failed'}})
    expect(loadShow(root, 'US-1')?.state).toBe('approved')
  })

  it('writeBack gives up as pending after four lock attempts', async () => {
    fs.writeFileSync(env.SHOWTIME_LOCK_FILE as string, 'x\n')
    let sleeps = 0
    const r = await writeBack(
      {copado: {appendStoryNote: async () => {}}, sleep: async () => void sleeps++, env},
      'US-1',
      'note',
    )
    expect(r).toBe('pending')
    expect(sleeps).toBe(3)
    expect(LockBusyError).toBeDefined()
  })

  it('a new round keeps the old decision as history, and status shows the timeline', async () => {
    const {gateway} = await send()
    const {d} = deps(gateway)
    await applyDecision(d, {story: 'US-1', kind: 'changes_requested', userId: 'U1', comment: 'fix it'})
    for (const s of ['scripted', 'recorded', 'narrated', 'rendered'] as const) transition(root, 'US-1', s)
    await send(gateway)
    expect(fs.readdirSync(path.join(showDir(root, 'US-1'), 'history'))).toHaveLength(1)
    expect(loadDecision(root, 'US-1')).toBeUndefined()
    expect(showStatus(root, 'US-1').state).toBe('sent')
  })
})

describe('.env loader', () => {
  it('loads values without overriding and ignores comments', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showtime-env-'))
    fs.writeFileSync(path.join(dir, '.env'), '# c\nA=1\nB="two"\nC=\n')
    const env: NodeJS.ProcessEnv = {A: 'keep'}
    expect(loadDotEnv(dir, env)).toEqual(['B'])
    expect(env).toEqual({A: 'keep', B: 'two'})
    fs.rmSync(dir, {recursive: true, force: true})
  })
})

describe('human status view', () => {
  it('hides identifier-only notes and keeps the readable ones', () => {
    for (const hidden of ['build=688733', 'hash=2e6d91524a5c', 'channel=C0C784GQGPP'])
      expect(isReadableNote(hidden)).toBe(false)
    for (const shown of [
      'source=ai',
      'voice=Samantha',
      'by=Priya',
      'channel=#uat-reviews'.replace('channel=', 'to '),
    ])
      expect(isReadableNote(shown)).toBe(true)
  })
})
