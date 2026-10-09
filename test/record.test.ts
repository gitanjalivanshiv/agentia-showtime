import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {zipSync} from 'fflate'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {describeCommand, FakeAgentiaClient} from '../src/agentia/client.js'
import {Copado} from '../src/agentia/copado.js'
import {LockBusyError, withOrgLock} from '../src/lock.js'
import {parseOutput} from '../src/record/parse.js'
import {recordShow} from '../src/record/record.js'
import {esc, generateRobot, stepKeyword} from '../src/record/robot.js'
import {parseScriptYaml} from '../src/script/generate.js'

const script = parseScriptYaml(
  fs.readFileSync(path.join(import.meta.dirname, '../examples/demo/script.fallback.yaml'), 'utf8'),
)

const msg = (t: string) => `<kw name="Log"><msg level="INFO">${t}</msg></kw>`
const shot = (n: string) =>
  `<kw name="Log Screenshot"><msg>Saved screenshot to /x/screenshots/${n}.png</msg><msg html="true">&lt;a href="screenshots/${n}.png"&gt;&lt;img src="screenshots/${n}.png"&gt;&lt;/a&gt;</msg></kw>`
const outputXml = (steps: Array<[string, boolean]>) =>
  `<robot>${steps.map(([id, ok]) => `${msg(`SHOWTIME_STEP_START:${id}`)}${shot(`shot-${id}`)}${msg(`SHOWTIME_STEP:${id}:${ok ? 'True' : 'False'}`)}`).join('')}</robot>`

describe('robot generator', () => {
  const robot = generateRobot(script)
  it('logs in with a one-time link and handles no password or username', () => {
    expect(robot).toContain('GoTo    ${FRONTDOOR_URL}')
    expect(robot).not.toMatch(/PASSWORD|TypeSecret|UAT_USERNAME/i)
    expect(robot).not.toMatch(/Log\s+\$\{FRONTDOOR_URL\}/)
  })
  it('wraps every step with markers, a retry and a screenshot', () => {
    for (const s of script.steps) {
      expect(robot).toContain(`SHOWTIME_STEP_START:${s.id}`)
      expect(robot).toContain(`SHOWTIME_STEP:${s.id}:\${ok}`)
    }
    expect(robot.match(/LogScreenshot/g)).toHaveLength(script.steps.length)
    expect(robot).toContain('Wait Until Keyword Succeeds    2x    2s')
  })
  it('maps actions to QWeb keywords', () => {
    const base = {id: 'a', caption: 'c', narration: 'one two three'}
    expect(stepKeyword({...base, action: 'navigate', target: 'Accounts'})).toBe(
      'GoTo    ${BASE}/lightning/o/Account/list',
    )
    expect(stepKeyword({...base, action: 'click', target: 'Save'})).toBe('ClickText    Save')
    expect(stepKeyword({...base, action: 'type', target: 'Subject', value: 'Hi'})).toBe(
      'TypeText    Subject    Hi',
    )
    expect(stepKeyword({...base, action: 'verify', target: 'Priority', value: 'High'})).toBe(
      'VerifyText    High',
    )
  })
  it('escapes Robot syntax and double spaces in script text', () => {
    expect(esc('a  b ${x}')).toBe('a b \\${x}')
    expect(esc('C:\\temp')).toBe('C:\\\\temp')
  })
  it('is deterministic', () => expect(generateRobot(script)).toBe(robot))
})

describe('output.xml parser', () => {
  it('pairs each step with its screenshot and result, in order', () => {
    const steps = parseOutput(
      outputXml([
        ['one', true],
        ['two', false],
      ]),
    )
    expect(steps).toEqual([
      {id: 'one', ok: true, screenshot: 'screenshots/shot-one.png'},
      {id: 'two', ok: false, screenshot: 'screenshots/shot-two.png'},
    ])
  })
  it('ignores screenshots outside a step', () => {
    expect(parseOutput(`<robot>${shot('stray')}</robot>`)).toEqual([])
  })
})

describe('describeCommand hides the login link', () => {
  it('masks FRONTDOOR_URL values', () => {
    expect(describeCommand(['testing', 'build', 'run', '--variable', 'FRONTDOOR_URL:https://x/secret'])).toBe(
      'agentia testing build run --variable FRONTDOOR_URL:***',
    )
  })
})

describe('org lock', () => {
  let dir: string
  let env: NodeJS.ProcessEnv
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showtime-lock-'))
    env = {SHOWTIME_LOCK_FILE: path.join(dir, '.org-busy')}
  })
  afterEach(() => fs.rmSync(dir, {recursive: true, force: true}))

  it('holds the lock while running and releases it afterwards', async () => {
    await withOrgLock(
      'x',
      async () =>
        expect(fs.readFileSync(env.SHOWTIME_LOCK_FILE as string, 'utf8')).toMatch(/^showtime: x started /),
      env,
    )
    expect(fs.existsSync(env.SHOWTIME_LOCK_FILE as string)).toBe(false)
  })
  it('releases the lock when the work fails', async () => {
    await expect(withOrgLock('x', async () => Promise.reject(new Error('boom')), env)).rejects.toThrow('boom')
    expect(fs.existsSync(env.SHOWTIME_LOCK_FILE as string)).toBe(false)
  })
  it('refuses to start when someone else holds it, and leaves their lock alone', async () => {
    fs.writeFileSync(env.SHOWTIME_LOCK_FILE as string, 'mutant: deploy started\n')
    await expect(withOrgLock('x', async () => 1, env)).rejects.toBeInstanceOf(LockBusyError)
    expect(fs.readFileSync(env.SHOWTIME_LOCK_FILE as string, 'utf8')).toBe('mutant: deploy started\n')
  })
})

describe('recordShow (fake Agentia)', () => {
  let root: string
  beforeEach(() => void (root = fs.mkdtempSync(path.join(os.tmpdir(), 'showtime-rec-'))))
  afterEach(() => fs.rmSync(root, {recursive: true, force: true}))

  const run = async (results: Array<[string, boolean]>) => {
    const client = new FakeAgentiaClient({
      'testing job upload': {result: {}},
      'testing build run': (args: string[]) => {
        const out = args[args.indexOf('--save-artifacts') + 1] as string
        const files: Record<string, Uint8Array> = {'output.xml': new TextEncoder().encode(outputXml(results))}
        for (const [id] of results) files[`screenshots/shot-${id}.png`] = new Uint8Array([137, 80, 78, 71])
        fs.writeFileSync(out, zipSync(files))
        return {result: {build: {data: {id: 99}}}}
      },
    })
    const rec = await recordShow({
      root,
      script: {...script, story: {name: 'US-1', title: 't'}},
      copado: new Copado(client, root),
      crtProjectId: 1,
      crtJobId: 2,
      frontdoor: async () => 'https://example.invalid/secur/frontdoor.jsp?sid=SECRET',
    })
    return {rec, client}
  }

  it('uploads, runs, and writes one numbered frame per step', async () => {
    const {rec, client} = await run(script.steps.map((s) => [s.id, true] as [string, boolean]))
    expect(rec.failed).toEqual([])
    expect(rec.buildId).toBe(99)
    expect(client.calls.map((c) => c.slice(0, 3).join(' '))).toEqual([
      'testing job upload',
      'testing build run',
    ])
    const frames = fs.readdirSync(path.join(root, '.showtime/shows/US-1/frames')).sort()
    expect(frames).toHaveLength(script.steps.length)
    expect(frames[0]).toBe('01-open-accounts.png')
  })
  it('passes the login link to the run as a variable, and never in the saved files', async () => {
    const {client} = await run(script.steps.map((s) => [s.id, true] as [string, boolean]))
    const buildCall = client.calls.find((c) => c[1] === 'build') as string[]
    expect(buildCall).toContain('--variable')
    expect(buildCall.join(' ')).toContain('FRONTDOOR_URL:https://example.invalid')
    const saved = fs.readdirSync(path.join(root, '.showtime/shows/US-1'), {recursive: true}).join('\n')
    expect(saved).not.toContain('SECRET')
    for (const f of ['session.robot', 'recording.json']) {
      expect(fs.readFileSync(path.join(root, '.showtime/shows/US-1', f), 'utf8')).not.toContain('SECRET')
    }
  })

  it('reports failed and missing steps', async () => {
    const {rec} = await run([
      [script.steps[0]!.id, true],
      [script.steps[1]!.id, false],
    ])
    expect(rec.failed).toContain(script.steps[1]!.id)
    expect(rec.failed).toContain(script.steps[2]!.id)
    expect(rec.failed).not.toContain(script.steps[0]!.id)
  })
})
