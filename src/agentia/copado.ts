import {z} from 'zod'

import type {AgentiaClient} from './client.js'

/** Typed, permissive views over the Agentia JSON we rely on. Unknown fields are ignored. */

const credentialSchema = z
  .object({
    type: z.string(),
    ready: z.boolean().optional(),
    set: z.boolean().optional(),
    domain: z.string().optional(),
    orgId: z.string().optional(),
    source: z.string().optional(),
    issues: z.array(z.unknown()).optional(),
  })
  .passthrough()

const authSchema = z.object({credentials: z.array(credentialSchema)}).passthrough()
export type AuthCredential = z.infer<typeof credentialSchema>

export const storySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    title: z.string(),
    status: z.string().optional(),
    owner: z.string().optional(),
    sourceEnvironmentName: z.string().optional(),
    lastModifiedDate: z.string().optional(),
    acceptanceCriteria: z.string().optional(),
    technicalSpecifications: z.string().optional(),
  })
  .passthrough()
export type Story = z.infer<typeof storySchema>

const workListSchema = z.object({data: z.array(storySchema), hasMore: z.boolean().optional()}).passthrough()

const crtProjectSchema = z.object({id: z.number(), name: z.string()}).passthrough()
export type CrtProject = z.infer<typeof crtProjectSchema>

const askSchema = z.object({content: z.string()}).passthrough()

export class Copado {
  constructor(
    private readonly client: AgentiaClient,
    private readonly cwd?: string,
  ) {}

  /** CRT auth. Gate on `ready`. Run from the project root so `--local` auth is found. */
  async crtAuth(): Promise<AuthCredential | undefined> {
    const r = await this.client.run(['auth', 'get', '--crt'], {cwd: this.cwd, schema: authSchema})
    return r.credentials.find((c) => c.type === 'crt')
  }

  async auth(): Promise<AuthCredential[]> {
    const r = await this.client.run(['auth', 'get'], {cwd: this.cwd, schema: authSchema})
    return r.credentials
  }

  async crtProjects(): Promise<CrtProject[]> {
    return this.client.run(['testing', 'project', 'list'], {cwd: this.cwd, schema: z.array(crtProjectSchema)})
  }

  async listStories(): Promise<Story[]> {
    const r = await this.client.run(['cicd', 'work', 'list'], {cwd: this.cwd, schema: workListSchema})
    return r.data
  }

  async getStory(idOrName: string): Promise<Story> {
    return this.client.run(['cicd', 'work', 'get', idOrName], {cwd: this.cwd, schema: storySchema})
  }

  /** Single-turn Copado AI call. `content` is the answer; the CLI's `completed` flag is unreliable. */
  async ask(agent: 'plan' | 'knowledge', prompt: string): Promise<string> {
    const r = await this.client.run(
      ['ai', 'agent', 'ask', '--agent', agent, '--no-stream', '--no-credential-sync', '-p', prompt],
      {cwd: this.cwd, schema: askSchema, timeoutMs: 120_000},
    )
    return r.content
  }
}
