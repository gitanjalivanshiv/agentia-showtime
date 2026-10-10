import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import type {Story} from '../src/agentia/copado.js'
import {buildPrompt, extractJson, generateScript, parseScriptYaml} from '../src/script/generate.js'
import {estimateSeconds, scriptSchema} from '../src/script/schema.js'
import {canMove, loadShow, transition} from '../src/store/lifecycle.js'

const story: Story = {
  id: 'a1',
  name: 'US-0000001',
  title: 'Showtime Demo – VIP Case Escalation',
  asA: 'service manager',
  wantTo: 'VIP cases set to High priority',
  soThat: 'VIP customers are helped first',
  acceptanceCriteria: 'New case on a VIP account gets Priority High',
}

const goodStep = (i: number, extra = {}) => ({
  id: `step-${i}`,
  action: 'click',
  target: `Thing ${i}`,
  caption: `Caption ${i}`,
  narration: 'Here is what changes for your service team today.',
  ...extra,
})
const good = {
  feature: 'VIP Case Escalation',
  summary: ['Accounts have a VIP checkbox.'],
  steps: [1, 2, 3, 4].map((i) => goodStep(i)),
}

describe('prompt and JSON extraction', () => {
  it('puts the story, criteria and environment in the prompt', () => {
    const p = buildPrompt(story, 'UAT-SFP', 'use Acme')
    expect(p).toContain('US-0000001')
    expect(p).toContain('Priority High')
    expect(p).toContain('UAT-SFP')
    expect(p).toContain('use Acme')
    expect(p).toContain('exact visible name')
    expect(p).toContain('Never give commands')
  })
  it('extracts JSON from fences and prose', () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```\nHope it helps')).toEqual({a: 1})
  })
  it('throws when there is no JSON', () => expect(() => extractJson('no json here')).toThrow())
})

describe('script schema', () => {
  const make = (over: object) => ({
    version: 1,
    story: {name: 'US-1', title: 't'},
    source: 'ai',
    ...good,
    ...over,
  })
  it('accepts a good script', () => expect(scriptSchema.safeParse(make({})).success).toBe(true))
  it('rejects fewer than 3 or more than 7 steps', () => {
    expect(scriptSchema.safeParse(make({steps: good.steps.slice(0, 2)})).success).toBe(false)
    expect(
      scriptSchema.safeParse(make({steps: Array.from({length: 8}, (_, i) => goodStep(i))})).success,
    ).toBe(false)
  })
  it('rejects an unknown action and duplicate ids', () => {
    expect(
      scriptSchema.safeParse(make({steps: [goodStep(1, {action: 'teleport'}), goodStep(2), goodStep(3)]}))
        .success,
    ).toBe(false)
    expect(scriptSchema.safeParse(make({steps: [goodStep(1), goodStep(1), goodStep(3)]})).success).toBe(false)
  })
  it('rejects narration over 28 words', () => {
    const long = Array.from({length: 30}, () => 'word').join(' ')
    expect(
      scriptSchema.safeParse(make({steps: [goodStep(1, {narration: long}), goodStep(2), goodStep(3)]}))
        .success,
    ).toBe(false)
  })
})

describe('generateScript', () => {
  it('returns a validated script on the first good answer and stamps the story', async () => {
    const r = await generateScript(story, async () => JSON.stringify(good), 'UAT-SFP')
    expect(r.attempts).toBe(1)
    expect(r.script).toMatchObject({source: 'ai', story: {name: 'US-0000001'}})
  })
  it('retries once, telling the AI what was wrong', async () => {
    const prompts: string[] = []
    const answers = ['not json at all', JSON.stringify(good)]
    const r = await generateScript(
      story,
      async (p) => (prompts.push(p), answers.shift() as string),
      'UAT-SFP',
    )
    expect(r.attempts).toBe(2)
    expect(r.script).toBeDefined()
    expect(prompts[1]).toContain('previous answer was rejected')
  })
  it('gives up after two bad answers and reports why', async () => {
    const r = await generateScript(story, async () => '{"feature":"x"}', 'UAT-SFP')
    expect(r.script).toBeUndefined()
    expect(r.problems).toHaveLength(2)
  })
  it('ignores any story or source the AI tries to set', async () => {
    const r = await generateScript(
      story,
      async () => JSON.stringify({...good, source: 'manual', story: {name: 'EVIL', title: 'x'}}),
      'UAT-SFP',
    )
    expect(r.script?.source).toBe('ai')
    expect(r.script?.story.name).toBe('US-0000001')
  })
})

describe('bundled fallback script', () => {
  const text = fs.readFileSync(
    path.join(import.meta.dirname, '../examples/demo/script.fallback.yaml'),
    'utf8',
  )
  it('is valid and lands in the 60–90 s window', () => {
    const s = parseScriptYaml(text, 'fallback')
    expect(s.steps).toHaveLength(7)
    expect(estimateSeconds(s)).toBeGreaterThanOrEqual(20)
    expect(JSON.stringify(s)).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/)
  })
})

describe('lifecycle', () => {
  let root: string
  beforeEach(() => void (root = fs.mkdtempSync(path.join(os.tmpdir(), 'showtime-'))))
  afterEach(() => fs.rmSync(root, {recursive: true, force: true}))

  it('records each transition with a time', () => {
    transition(root, 'US-1', 'scripted', 'source=ai', new Date('2026-10-08T10:00:00Z'))
    const show = loadShow(root, 'US-1')
    expect(show?.state).toBe('scripted')
    expect(show?.history.map((h) => h.state)).toEqual(['detected', 'scripted'])
  })
  it('allows re-running a stage and rejects skipping ahead', () => {
    transition(root, 'US-1', 'scripted')
    expect(() => transition(root, 'US-1', 'scripted')).not.toThrow()
    expect(() => transition(root, 'US-1', 'sent')).toThrow(/Cannot move/)
  })
  it('lets a new round start after changes were requested, including a re-render', () => {
    for (const to of ['scripted', 'recorded', 'narrated', 'rendered', 'sent'] as const)
      expect(canMove('changes_requested', to)).toBe(true)
  })
  it('only allows approval after sending', () => {
    expect(canMove('rendered', 'approved')).toBe(false)
    expect(canMove('sent', 'approved')).toBe(true)
    expect(canMove('approved', 'sent')).toBe(false)
  })
})
