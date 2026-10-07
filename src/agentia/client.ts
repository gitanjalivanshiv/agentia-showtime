import {execa} from 'execa'
import type {ZodType} from 'zod'

/**
 * The only way Showtime talks to Copado: spawn the public `agentia` binary with `--json`
 * and parse stdout. It never imports Agentia internals. See docs/agentia-commands.md.
 */

export interface RunOptions<T> {
  /** Working directory. Matters: project-scoped (`--local`) auth is resolved from cwd. */
  cwd?: string
  timeoutMs?: number
  /** Validates `result`. Schemas should be permissive so new CLI fields never break us. */
  schema?: ZodType<T>
}

export interface AgentiaClient {
  run<T = unknown>(args: string[], options?: RunOptions<T>): Promise<T>
}

export class AgentiaError extends Error {
  override readonly name = 'AgentiaError'
  constructor(
    message: string,
    readonly details: {
      command: string
      exitCode?: number
      /** Error class reported by the CLI, e.g. CicdGatewayError, TestingGatewayError. */
      errorName?: string
      statusCode?: number
    },
  ) {
    super(message)
  }
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000
const MAX_BUFFER = 64 * 1024 * 1024

/** Command line for messages: drops values that follow secret-looking flags. */
export function describeCommand(args: string[]): string {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    out.push(a)
    if (/^--(crt|cicd|ai|value|git-password)$/.test(a) && i + 1 < args.length) {
      out.push('***')
      i++
    }
  }
  return `agentia ${out.join(' ')}`
}

/**
 * Turns a parsed stdout document into the `result` or an AgentiaError.
 * Reads only message/name/statusCode from errors: never the raw payload, which can
 * contain request URLs with org IDs.
 */
export function unwrap<T>(doc: unknown, exitCode: number, args: string[], schema?: ZodType<T>): T {
  const command = describeCommand(args)
  if (!doc || typeof doc !== 'object') {
    throw new AgentiaError(`agentia returned no JSON (exit ${exitCode})`, {command, exitCode})
  }
  const d = doc as {result?: unknown; error?: Record<string, unknown>}
  if (d.error) {
    const e = d.error
    throw new AgentiaError(typeof e.message === 'string' ? e.message : 'agentia command failed', {
      command,
      exitCode,
      errorName: typeof e.name === 'string' ? e.name : undefined,
      statusCode: typeof e.statusCode === 'number' ? e.statusCode : undefined,
    })
  }
  if (exitCode !== 0) throw new AgentiaError(`agentia exited with ${exitCode}`, {command, exitCode})
  if (!schema) return d.result as T
  const parsed = schema.safeParse(d.result)
  if (!parsed.success) {
    throw new AgentiaError(`Unexpected JSON shape from ${command}: ${parsed.error.message}`, {
      command,
      exitCode,
    })
  }
  return parsed.data
}

/** The CLI prints linked-plugin warnings (lines starting with `›`) around the JSON; parse from the first brace. */
export function parseStdout(stdout: string): unknown {
  const text = stdout.trim()
  if (!text) return undefined
  for (const candidate of [text, text.slice(Math.max(text.indexOf('{'), 0))]) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try the next candidate
    }
  }
  return undefined
}

/** Real client. stderr is ignored on purpose: other linked plugins print oclif warnings there. */
export class ProcessAgentiaClient implements AgentiaClient {
  constructor(private readonly options: {bin?: string; defaultCwd?: string} = {}) {}

  async run<T = unknown>(args: string[], options: RunOptions<T> = {}): Promise<T> {
    const fullArgs = args.includes('--json') ? args : [...args, '--json']
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const proc = await execa(this.options.bin ?? 'agentia', fullArgs, {
      cwd: options.cwd ?? this.options.defaultCwd,
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER,
      reject: false,
      env: {NO_COLOR: '1', FORCE_COLOR: '0'},
    })
    const command = describeCommand(args)
    if (proc.timedOut) throw new AgentiaError(`Timed out after ${Math.round(timeoutMs / 1000)} s`, {command})
    if (proc.failed && proc.exitCode === undefined) {
      throw new AgentiaError(`Could not run agentia: ${proc.shortMessage}`, {command})
    }
    const doc = parseStdout(typeof proc.stdout === 'string' ? proc.stdout : '')
    return unwrap(doc, proc.exitCode ?? 1, args, options.schema)
  }
}

/**
 * Test double. Responses are keyed by the command words (flags with values included, `--json`
 * excluded), e.g. `cicd work list`. A handler gets the full args so it can branch on them.
 */
export type FakeResponse = unknown | ((args: string[]) => unknown)

export class FakeAgentiaClient implements AgentiaClient {
  readonly calls: string[][] = []

  constructor(private readonly responses: Record<string, FakeResponse>) {}

  async run<T = unknown>(args: string[], options: RunOptions<T> = {}): Promise<T> {
    const clean = args.filter((a) => a !== '--json')
    this.calls.push(clean)
    const key = Object.keys(this.responses)
      .filter((k) => clean.join(' ') === k || clean.join(' ').startsWith(`${k} `))
      .sort((a, b) => b.length - a.length)[0]
    if (key === undefined) {
      throw new AgentiaError(`FakeAgentiaClient: no response for "${clean.join(' ')}"`, {
        command: describeCommand(args),
      })
    }
    const r = this.responses[key]
    const doc = typeof r === 'function' ? (r as (a: string[]) => unknown)(clean) : r
    return unwrap(doc, 0, args, options.schema)
  }
}

/** `SHOWTIME_AGENTIA_BIN` points at a stand-in binary (fakes, demos). */
export function createAgentiaClient(cwd?: string): AgentiaClient {
  return new ProcessAgentiaClient({bin: process.env.SHOWTIME_AGENTIA_BIN, defaultCwd: cwd})
}
