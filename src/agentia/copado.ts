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
    asA: z.string().optional(),
    wantTo: z.string().optional(),
    soThat: z.string().optional(),
    technicalSpecifications: z.string().optional(),
  })
  .passthrough()
export type Story = z.infer<typeof storySchema>

const workListSchema = z.object({data: z.array(storySchema), hasMore: z.boolean().optional()}).passthrough()

const crtProjectSchema = z.object({id: z.number(), name: z.string()}).passthrough()
export type CrtProject = z.infer<typeof crtProjectSchema>

const crtJobSchema = z.object({id: z.number(), name: z.string()}).passthrough()
export type CrtJob = z.infer<typeof crtJobSchema>

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

  async listStories(o: {title?: string} = {}): Promise<Story[]> {
    const args = ['cicd', 'work', 'list', '--page-size', '100', ...(o.title ? ['--title', o.title] : [])]
    const r = await this.client.run(args, {cwd: this.cwd, schema: workListSchema})
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

  async crtJobs(projectId: number): Promise<CrtJob[]> {
    return this.client.run(['testing', 'job', 'list', '-p', String(projectId)], {
      cwd: this.cwd,
      schema: z.array(crtJobSchema),
    })
  }

  /** Replaces one file in a CRT job. A write: the caller holds the org lock. */
  async uploadRobot(projectId: number, jobId: number, localFile: string, remoteName: string): Promise<void> {
    await this.client.run(
      [
        'testing',
        'job',
        'upload',
        String(jobId),
        '-p',
        String(projectId),
        '--replace',
        `${localFile}:${remoteName}`,
        '--message',
        'Showtime recording',
      ],
      {cwd: this.cwd},
    )
  }

  /** Runs the job and waits. Artifacts (zip) are written to `archivePath`. Returns the build ID. */
  async runBuild(
    projectId: number,
    jobId: number,
    archivePath: string,
    variables: string[] = [],
  ): Promise<number | undefined> {
    const r = await this.client.run<{build?: {data?: {id?: number}}}>(
      [
        'testing',
        'build',
        'run',
        String(jobId),
        '-p',
        String(projectId),
        '--wait-for-result',
        '--timeout',
        '900',
        '--save-artifacts',
        archivePath,
        ...variables.flatMap((v) => ['--variable', v]),
      ],
      {cwd: this.cwd, timeoutMs: 20 * 60 * 1000},
    )
    return r.build?.data?.id
  }

  /**
   * Writes a Showtime note onto the story's Technical Specifications field, keeping everything already there.
   * A write: the caller holds the org lock. Never touches the story's status.
   */
  async appendStoryNote(idOrName: string, merge: (existing: string | undefined) => string): Promise<void> {
    const story = await this.getStory(idOrName)
    await this.client.run(
      [
        'cicd',
        'work',
        'update',
        story.id,
        '--technical-specifications',
        merge(story.technicalSpecifications),
      ],
      {cwd: this.cwd},
    )
  }
}
