import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import type {Story} from '../src/agentia/copado.js'
import {configSchema, DEFAULT_CONFIG, projectRoot, saveConfig, type ShowtimeConfig} from '../src/config.js'
import {LockBusyError} from '../src/lock.js'
import {buildServer} from '../src/mcp/server.js'
import {PipelineError, resolveHint, runPipeline, type StageName, type Stages} from '../src/pipeline.js'
import {saveDecision} from '../src/review/store.js'
import {
  INSTRUCTION_BLOCK,
  installSkill,
  instructionFile,
  updateInstructions,
  writeRootPointer,
} from '../src/skill.js'
import {findCandidates, watchOnce} from '../src/watch.js'
import {transition} from '../src/store/lifecycle.js'

const config: ShowtimeConfig = configSchema.parse({...DEFAULT_CONFIG, crtProjectId: 1, crtJobId: 2})
let root: string
beforeEach(() => void (root = fs.mkdtempSync(path.join(os.tmpdir(), 'showtime-pipe-'))))
afterEach(() => fs.rmSync(root, {recursive: true, force: true}))

const fakeStages = (
  log: string[] = [],
  failAt?: StageName,
  failWith: unknown = new Error('boom'),
): Stages => {
  const stage = (name: StageName) => async (story: string) => {
    log.push(`${name}:${story}`)
    if (name === failAt) throw failWith
    return {detail: `${name} ok`}
  }
  return {script: stage('script'), record: stage('record'), render: stage('render'), send: stage('send')}
}

describe('runPipeline', () => {
  it('runs the four stages in order with a progress line per stage', async () => {
    const log: string[] = []
    const lines: string[] = []
    const r = await runPipeline(fakeStages(log), 'US-1', {progress: (l) => lines.push(l)})
    expect(log).toEqual(['script:US-1', 'record:US-1', 'render:US-1', 'send:US-1'])
    expect(lines.filter((l) => l.includes('✓'))).toHaveLength(4)
    expect(r.stages.map((s) => s.stage)).toEqual(['script', 'record', 'render', 'send'])
  })
  it('stops at the first failure and names the stage', async () => {
    const log: string[] = []
    await expect(runPipeline(fakeStages(log, 'record'), 'US-1')).rejects.toMatchObject({
      name: 'PipelineError',
      stage: 'record',
      message: 'boom',
    })
    expect(log).toEqual(['script:US-1', 'record:US-1'])
  })
  it('skips Slack with skipSend and can start from a later stage', async () => {
    const log: string[] = []
    await runPipeline(fakeStages(log), 'US-1', {skipSend: true, from: 'render'})
    expect(log).toEqual(['render:US-1'])
  })
})

describe('hints', () => {
  it('prefers the flag, then the per-story file, then the config', () => {
    const c = {...config, scriptHint: 'from config'}
    expect(resolveHint(root, c, 'US-1')).toBe('from config')
    fs.mkdirSync(path.join(root, '.showtime/hints'), {recursive: true})
    fs.writeFileSync(path.join(root, '.showtime/hints/US-1.txt'), 'from file\n')
    expect(resolveHint(root, c, 'US-1')).toBe('from file')
    expect(resolveHint(root, c, 'US-1', 'from flag')).toBe('from flag')
  })
})

describe('project root', () => {
  it('uses SHOWTIME_ROOT, else the nearest parent with a config, else the folder itself', () => {
    saveConfig(root, config)
    const deep = path.join(root, 'a/b')
    fs.mkdirSync(deep, {recursive: true})
    expect(projectRoot(deep, {})).toBe(root)
    expect(projectRoot(deep, {SHOWTIME_ROOT: '/elsewhere'})).toBe('/elsewhere')
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'showtime-bare-'))
    expect(projectRoot(bare, {})).toBe(bare)
    fs.rmSync(bare, {recursive: true, force: true})
  })
})

const story = (name: string, over: Partial<Story> = {}): Story => ({
  id: `id-${name}`,
  name,
  title: `${config.storyPrefix} ${name}`,
  sourceEnvironmentName: config.uatEnvironment,
  lastModifiedDate: '2026-10-09T10:00:00Z',
  ...over,
})
const copadoWith = (stories: Story[]) => ({listStories: async () => stories})

describe('watch', () => {
  it('picks up only Showtime stories that are in the UAT environment', async () => {
    const found = await findCandidates(
      copadoWith([
        story('US-1'),
        story('US-2', {sourceEnvironmentName: 'INT-SFP'}),
        story('US-3', {title: 'Mutant Lab – x'}),
      ]),
      config,
      root,
    )
    expect(found.map((c) => c.story.name)).toEqual(['US-1'])
  })
  it('skips stories already sent or approved', async () => {
    for (const s of ['scripted', 'recorded', 'narrated', 'rendered', 'sent'] as const)
      transition(root, 'US-1', s)
    expect(await findCandidates(copadoWith([story('US-1')]), config, root)).toEqual([])
  })
  it('starts a new round when a story changes after changes were requested, but not for our own note', async () => {
    for (const s of ['scripted', 'recorded', 'narrated', 'rendered', 'sent', 'changes_requested'] as const)
      transition(root, 'US-1', s)
    saveDecision(root, {
      story: 'US-1',
      kind: 'changes_requested',
      by: 'P',
      byId: 'U',
      at: '2026-10-09T12:00:00Z',
      copado: 'written',
      copadoAt: '2026-10-09T12:00:05Z',
    })
    const own = story('US-1', {lastModifiedDate: '2026-10-09T12:00:06Z'})
    expect(await findCandidates(copadoWith([own]), config, root)).toEqual([])
    const fixed = story('US-1', {lastModifiedDate: '2026-10-09T15:00:00Z'})
    expect((await findCandidates(copadoWith([fixed]), config, root)).map((c) => c.reason)).toEqual([
      'new-round',
    ])
  })
  it('runs candidates, and stops retrying a story after two failures', async () => {
    const logs: string[] = []
    const run = (stages: Stages) =>
      watchOnce({root, config, copado: copadoWith([story('US-1')]), stages, log: (l) => logs.push(l)})
    expect((await run(fakeStages([], 'record'))).failed).toHaveLength(1)
    expect((await run(fakeStages([], 'record'))).failed).toHaveLength(1)
    expect((await run(fakeStages())).found).toEqual([])
  })
  it('treats a held shared lock as "try again", not a failure', async () => {
    const stages = fakeStages(
      [],
      'record',
      new PipelineError('record', 'locked', new LockBusyError('mutant: x')),
    )
    const r = await watchOnce({root, config, copado: copadoWith([story('US-1')]), stages, log: () => {}})
    expect(r.waiting).toEqual(['US-1'])
    expect(r.failed).toEqual([])
    expect(fs.existsSync(path.join(root, '.showtime/shows/US-1/failure.json'))).toBe(false)
  })
  it('--dry-run reports and runs nothing', async () => {
    const log: string[] = []
    const r = await watchOnce({
      root,
      config,
      copado: copadoWith([story('US-1')]),
      stages: fakeStages(log),
      log: () => {},
      dryRun: true,
    })
    expect(r.found).toEqual(['US-1'])
    expect(log).toEqual([])
  })
})

describe('MCP server', () => {
  const connect = async (stages: Stages = fakeStages()) => {
    const server = buildServer({
      root,
      config,
      stages: () => stages,
      previewScript: async () => {
        throw new Error('not used')
      },
    })
    const [a, b] = InMemoryTransport.createLinkedPair()
    const client = new Client({name: 'test', version: '0'})
    await Promise.all([server.connect(a), client.connect(b)])
    return client
  }
  const text = (r: unknown) => ((r as {content: Array<{text: string}>}).content[0] as {text: string}).text

  it('offers exactly four tools and none that approves or promotes', async () => {
    const tools = (await (await connect()).listTools()).tools.map((t) => t.name).sort()
    expect(tools).toEqual(['showtime_feedback', 'showtime_run', 'showtime_script_preview', 'showtime_status'])
    expect(tools.join(' ')).not.toMatch(/approve|promote|deploy/)
  })
  it('showtime_run only plans until confirm is true', async () => {
    const log: string[] = []
    const client = await connect(fakeStages(log))
    const plan = JSON.parse(text(await client.callTool({name: 'showtime_run', arguments: {story: 'US-1'}})))
    expect(plan.needsConfirmation).toBe(true)
    expect(plan.plan.join(' ')).toContain('shared lock')
    expect(log).toEqual([])
    const done = JSON.parse(
      text(await client.callTool({name: 'showtime_run', arguments: {story: 'US-1', confirm: true}})),
    )
    expect(done.stages).toHaveLength(4)
    expect(log).toHaveLength(4)
  })
  it('showtime_run reports a failed stage as an error', async () => {
    const client = await connect(fakeStages([], 'render'))
    const r = (await client.callTool({name: 'showtime_run', arguments: {story: 'US-1', confirm: true}})) as {
      isError?: boolean
    }
    expect(r.isError).toBe(true)
    expect(text(r)).toContain('render failed')
  })
  it('showtime_feedback returns the comment and says not to approve or promote', async () => {
    for (const s of ['scripted', 'recorded', 'narrated', 'rendered', 'sent', 'changes_requested'] as const)
      transition(root, 'US-1', s)
    saveDecision(root, {
      story: 'US-1',
      kind: 'changes_requested',
      by: 'Priya',
      byId: 'U',
      at: '2026-10-09T12:00:00Z',
      comment: 'Also escalate for Platinum.',
      copado: 'written',
    })
    fs.mkdirSync(path.join(root, '.showtime/feedback'), {recursive: true})
    fs.writeFileSync(path.join(root, '.showtime/feedback/US-1.md'), '# fb\n\nAlso escalate for Platinum.\n')
    const out = JSON.parse(
      text(await (await connect()).callTool({name: 'showtime_feedback', arguments: {story: 'US-1'}})),
    )
    expect(out.decision).toMatchObject({kind: 'changes_requested', by: 'Priya'})
    expect(out.feedback).toContain('Platinum')
    expect(out.next).toContain('Plan the fix')
  })
  it('showtime_status lists shows', async () => {
    transition(root, 'US-1', 'scripted')
    const out = JSON.parse(text(await (await connect()).callTool({name: 'showtime_status', arguments: {}})))
    expect(out.shows[0]).toMatchObject({story: 'US-1', state: 'scripted'})
  })
})

describe('root pointer', () => {
  it('lets a developer repo find the Showtime state, and ignores a pointer to nowhere', () => {
    saveConfig(root, config)
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'showtime-repo-'))
    const sub = path.join(repo, 'force-app/main')
    fs.mkdirSync(sub, {recursive: true})
    expect(writeRootPointer(root, root)).toBeUndefined()
    writeRootPointer(repo, root)
    expect(projectRoot(sub, {})).toBe(root)
    fs.writeFileSync(path.join(repo, '.showtime-root'), '/does/not/exist\n')
    expect(projectRoot(sub, {})).toBe(sub)
    fs.rmSync(repo, {recursive: true, force: true})
  })
})

describe('skill', () => {
  it('installs into the chosen skills folder and replaces an older copy', () => {
    const dest = installSkill(root, 'claude')
    expect(dest).toBe(path.join(root, '.claude/skills/showtime'))
    fs.writeFileSync(path.join(dest, 'stale.txt'), 'x')
    installSkill(root, 'claude')
    expect(fs.existsSync(path.join(dest, 'stale.txt'))).toBe(false)
    const md = fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')
    expect(md).toMatch(/^---\nname: showtime\ndescription: .+\n---/)
    expect(fs.existsSync(path.join(dest, 'references/commands.md'))).toBe(true)
  })
  it('adds a managed note without touching other text, and refreshes it in place', () => {
    const file = path.join(root, 'CLAUDE.md')
    fs.writeFileSync(file, '# My project\n\nKeep this.\n')
    updateInstructions(root, 'claude')
    updateInstructions(root, 'claude')
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toContain('Keep this.')
    expect(text.match(/showtime:start/g)).toHaveLength(1)
    expect(text).toContain('load the `showtime` skill')
    expect(instructionFile('agents')).toBe('AGENTS.md')
    expect(INSTRUCTION_BLOCK).toContain('Never mark a story approved')
  })
  it('creates the instruction file when there is none', () => {
    updateInstructions(root, 'agents')
    expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toContain('showtime:end')
  })
  it('tells the agent never to approve or promote, and to ask before running', () => {
    const md = fs.readFileSync(path.join(import.meta.dirname, '../skills/showtime/SKILL.md'), 'utf8')
    expect(md).toMatch(/Never mark a story approved yourself/)
    expect(md).toMatch(/Never promote or deploy on the business owner's behalf/)
    expect(md).toMatch(/Ask before `showtime_run`/)
  })
})
