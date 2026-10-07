import {describe, expect, it} from 'vitest'
import {z} from 'zod'

import {AgentiaError, describeCommand, FakeAgentiaClient, parseStdout, unwrap} from '../src/agentia/client.js'

describe('parseStdout', () => {
  it('parses plain JSON', () => expect(parseStdout('{"result":1}')).toEqual({result: 1}))
  it('skips linked-plugin warnings printed before the JSON', () => {
    expect(parseStdout(' › Warning: x\n › y\n{"result":2}')).toEqual({result: 2})
  })
  it('returns undefined for garbage', () => expect(parseStdout('nope')).toBeUndefined())
})

describe('unwrap', () => {
  it('returns the validated result', () => {
    expect(unwrap({result: {a: 1}}, 0, ['x'], z.object({a: z.number()}))).toEqual({a: 1})
  })
  it('turns an error envelope into AgentiaError without leaking the payload', () => {
    const doc = {
      error: {
        name: 'TestingGatewayError',
        statusCode: 403,
        message: 'CRT request failed (403).',
        requestUrl: 'https://secret/org/42',
      },
    }
    try {
      unwrap(doc, 1, ['testing', 'project', 'list'])
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(AgentiaError)
      expect((e as AgentiaError).details).toMatchObject({errorName: 'TestingGatewayError', statusCode: 403})
      expect(JSON.stringify((e as AgentiaError).details)).not.toContain('secret')
    }
  })
  it('rejects an unexpected shape', () => {
    expect(() => unwrap({result: {a: 'x'}}, 0, ['x'], z.object({a: z.number()}))).toThrow(
      /Unexpected JSON shape/,
    )
  })
  it('fails on a non-zero exit even with a result', () => {
    expect(() => unwrap({result: {}}, 2, ['x'])).toThrow(/exited with 2/)
  })
})

describe('describeCommand', () => {
  it('hides secret flag values', () => {
    expect(describeCommand(['auth', 'set', '--crt', 'SECRETPAK', '--crt-org', '1'])).toBe(
      'agentia auth set --crt *** --crt-org 1',
    )
  })
})

describe('FakeAgentiaClient', () => {
  it('matches the longest command prefix and ignores --json', async () => {
    const fake = new FakeAgentiaClient({
      'cicd work': {result: 'short'},
      'cicd work list': {result: 'long'},
    })
    expect(await fake.run(['cicd', 'work', 'list', '--json'])).toBe('long')
    expect(fake.calls).toEqual([['cicd', 'work', 'list']])
  })
  it('throws for an unknown command', async () => {
    await expect(new FakeAgentiaClient({}).run(['nope'])).rejects.toThrow(/no response/)
  })
})
