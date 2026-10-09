import fs from 'node:fs'
import path from 'node:path'
import {z} from 'zod'

/** `.showtime/config.json`. Git-ignored: it holds environment names and a CRT project ID. */
export const configSchema = z.object({
  /** Environment whose arrival of a story starts a show. */
  uatEnvironment: z.string().min(1),
  /** Environment the story is developed in (informational; Showtime never writes there). */
  devEnvironment: z.string().min(1),
  crtProjectId: z.number().int().positive(),
  /** CRT job that hosts the generated robot suite ("Showtime Recorder"). */
  crtJobId: z.number().int().positive().optional(),
  /** Salesforce CLI alias of the UAT org. Recording logs in with a one-time link from `sf org open`. */
  sfAlias: z.string().min(1).default('showtime-uat'),
  slack: z.object({
    ownersChannel: z.string().min(1),
    releaseChannel: z.string().min(1),
    /** Slack member IDs allowed to approve or request changes. Empty or missing means anyone in the channel. */
    approverIds: z.array(z.string()).optional(),
  }),
  /** Org URL for the "Open in UAT" button, e.g. https://example.my.salesforce.com. Optional. */
  uatUrl: z.string().url().optional(),
  voice: z.object({name: z.string().min(1), rate: z.number().int().positive()}),
  storyPrefix: z.string().min(1).default('Showtime Demo –'),
})
export type ShowtimeConfig = z.infer<typeof configSchema>

export const CONFIG_DIR = '.showtime'
export const configPath = (root: string) => path.join(root, CONFIG_DIR, 'config.json')

export const DEFAULT_CONFIG: Omit<ShowtimeConfig, 'crtProjectId' | 'crtJobId'> = {
  sfAlias: 'showtime-uat',
  uatEnvironment: 'UAT-SFP',
  devEnvironment: 'INT-SFP',
  slack: {ownersChannel: '#uat-reviews', releaseChannel: '#release'},
  voice: {name: 'Samantha', rate: 165},
  storyPrefix: 'Showtime Demo –',
}

export type LoadedConfig =
  {ok: true; config: ShowtimeConfig} | {ok: false; reason: 'missing' | 'invalid'; message: string}

export function loadConfig(root: string): LoadedConfig {
  const file = configPath(root)
  if (!fs.existsSync(file)) return {ok: false, reason: 'missing', message: `${file} not found`}
  try {
    return {ok: true, config: configSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))}
  } catch (e) {
    return {ok: false, reason: 'invalid', message: e instanceof Error ? e.message : String(e)}
  }
}

export function saveConfig(root: string, config: ShowtimeConfig): string {
  const file = configPath(root)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)
  return file
}
