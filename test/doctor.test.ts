import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {FakeAgentiaClient} from '../src/agentia/client.js'
import {configSchema, DEFAULT_CONFIG, saveConfig} from '../src/config.js'
import {hasFailures, runDoctor} from '../src/doctor.js'

const read = (f: string) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', f), 'utf8'))

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'showtime-'))
})
afterEach(() => fs.rmSync(root, {recursive: true, force: true}))

const client = (auth = read('auth-get.json')) =>
  new FakeAgentiaClient({
    'auth get': auth,
    'testing project list': read('project-list.json'),
    'testing job list': read('job-list.json'),
  })
const byId = (checks: Awaited<ReturnType<typeof runDoctor>>, id: string) => checks.find((c) => c.id === id)
const voices = async () => ['Samantha', 'Albert']

describe('doctor', () => {
  it('is all green with config, auth, ffmpeg, voice and Slack tokens', async () => {
    saveConfig(root, configSchema.parse({...DEFAULT_CONFIG, crtProjectId: 1001, crtJobId: 2001}))
    fs.writeFileSync(path.join(root, '.env'), 'SLACK_BOT_TOKEN=xoxb-fake\nSLACK_APP_TOKEN=xapp-fake\n')
    const checks = await runDoctor({root, client: client(), sayVoices: voices, env: {}})
    expect(checks.filter((c) => c.status !== 'ok')).toEqual([])
    expect(hasFailures(checks)).toBe(false)
  })

  it('fails with a fix when config is missing', async () => {
    const checks = await runDoctor({root, client: client(), sayVoices: voices, env: {}})
    expect(byId(checks, 'config')).toMatchObject({status: 'fail', fix: 'Run `agentia showtime init`.'})
    expect(hasFailures(checks)).toBe(true)
  })

  it('fails when CRT is not ready, and tells the user the exact command', async () => {
    const auth = read('auth-get.json')
    auth.result.credentials[1].ready = false
    const checks = await runDoctor({root, client: client(auth), sayVoices: voices, env: {}})
    expect(byId(checks, 'crt-auth')?.status).toBe('fail')
    expect(byId(checks, 'crt-auth')?.fix).toContain('agentia auth set --local --crt')
  })

  it('fails when the configured CRT project is not visible', async () => {
    saveConfig(root, configSchema.parse({...DEFAULT_CONFIG, crtProjectId: 999}))
    const checks = await runDoctor({root, client: client(), sayVoices: voices, env: {}})
    expect(byId(checks, 'crt-project')?.status).toBe('fail')
  })

  it('warns, not fails, when Slack tokens are missing', async () => {
    const checks = await runDoctor({root, client: client(), sayVoices: voices, env: {}})
    expect(byId(checks, 'slack')?.status).toBe('warn')
  })

  it('never reports secret values from .env', async () => {
    fs.writeFileSync(path.join(root, '.env'), 'SLACK_BOT_TOKEN=xoxb-SUPERSECRET\n')
    const checks = await runDoctor({root, client: client(), sayVoices: voices, env: {}})
    expect(JSON.stringify(checks)).not.toContain('SUPERSECRET')
  })

  it('warns when the configured voice is not installed', async () => {
    saveConfig(
      root,
      configSchema.parse({...DEFAULT_CONFIG, crtProjectId: 1001, voice: {name: 'Zelda', rate: 170}}),
    )
    const checks = await runDoctor({root, client: client(), sayVoices: voices, env: {}})
    expect(byId(checks, 'say')?.status).toBe('warn')
  })

  it('fails the Node check on an old runtime', async () => {
    const checks = await runDoctor({
      root,
      client: client(),
      sayVoices: voices,
      env: {},
      nodeVersion: '18.0.0',
    })
    expect(byId(checks, 'node')?.status).toBe('fail')
  })
})

describe('doctor: recorder job', () => {
  it('fails with a fix when the config has no crtJobId', async () => {
    saveConfig(root, configSchema.parse({...DEFAULT_CONFIG, crtProjectId: 1001}))
    const checks = await runDoctor({root, client: client(), sayVoices: voices, env: {}})
    expect(byId(checks, 'crt-job')).toMatchObject({status: 'fail'})
  })
})
