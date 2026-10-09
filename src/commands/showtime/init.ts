import fs from 'node:fs'
import path from 'node:path'

import {Flags} from '@oclif/core'

import {createAgentiaClient} from '../../agentia/client.js'
import {Copado} from '../../agentia/copado.js'
import {ShowtimeCommand} from '../../base-command.js'
import {configPath, configSchema, DEFAULT_CONFIG, saveConfig, type ShowtimeConfig} from '../../config.js'
import {envKeys} from '../../doctor.js'

export default class Init extends ShowtimeCommand {
  static override description =
    'Create .showtime/config.json (UAT environment, CRT project, Slack channels, voice) and check .env. Run `showtime doctor` afterwards.'
  static override flags = {
    'uat-environment': Flags.string({
      description: 'Environment a story must reach to start a show',
      default: DEFAULT_CONFIG.uatEnvironment,
    }),
    'dev-environment': Flags.string({
      description: 'Environment the story is developed in',
      default: DEFAULT_CONFIG.devEnvironment,
    }),
    'crt-project': Flags.integer({
      description: 'Robotic Testing project ID (auto-detected when a project named "Showtime" exists)',
    }),
    'owners-channel': Flags.string({
      description: 'Slack channel for business-owner reviews',
      default: DEFAULT_CONFIG.slack.ownersChannel,
    }),
    'release-channel': Flags.string({
      description: 'Slack channel for release managers',
      default: DEFAULT_CONFIG.slack.releaseChannel,
    }),
    'crt-job': Flags.integer({
      description:
        'CRT job that hosts recordings (auto-detected when a job named "Showtime Recorder" exists)',
    }),
    'sf-alias': Flags.string({
      description: 'Salesforce CLI alias of the UAT org',
      default: DEFAULT_CONFIG.sfAlias,
    }),
    voice: Flags.string({description: 'macOS `say` voice', default: DEFAULT_CONFIG.voice.name}),
    rate: Flags.integer({description: 'Speech rate in words per minute', default: DEFAULT_CONFIG.voice.rate}),
    force: Flags.boolean({description: 'Overwrite an existing config'}),
    'dry-run': Flags.boolean({description: 'Show the config without writing it'}),
  }

  async run(): Promise<{config: ShowtimeConfig; path: string; written: boolean; missingEnv: string[]}> {
    const {flags} = await this.parse(Init)
    const root = process.cwd()
    const file = configPath(root)
    if (fs.existsSync(file) && !flags.force && !flags['dry-run']) {
      this.error(`${path.relative(root, file)} already exists. Re-run with --force to overwrite it.`, {
        exit: 1,
      })
    }

    let crtProjectId = flags['crt-project']
    if (crtProjectId === undefined) {
      try {
        const projects = await new Copado(createAgentiaClient(root), root).crtProjects()
        crtProjectId = projects.find((p) => p.name.toLowerCase() === 'showtime')?.id
      } catch (e) {
        this.error(
          `Could not list Robotic Testing projects: ${e instanceof Error ? e.message : String(e)}. Pass --crt-project <id>.`,
          {exit: 1},
        )
      }
    }
    if (crtProjectId === undefined) {
      this.error(
        'No CRT project named "Showtime" was found. Create one in Robotic Testing, or pass --crt-project <id>.',
        {exit: 1},
      )
    }

    let crtJobId = flags['crt-job']
    if (crtJobId === undefined) {
      try {
        const jobs = await new Copado(createAgentiaClient(root), root).crtJobs(crtProjectId)
        crtJobId = jobs.find((j) => j.name.toLowerCase() === 'showtime recorder')?.id
      } catch {
        // Optional: recording needs it, but init can run before the job exists.
      }
    }

    const config = configSchema.parse({
      uatEnvironment: flags['uat-environment'],
      devEnvironment: flags['dev-environment'],
      crtProjectId,
      crtJobId,
      sfAlias: flags['sf-alias'],
      slack: {ownersChannel: flags['owners-channel'], releaseChannel: flags['release-channel']},
      voice: {name: flags.voice, rate: flags.rate},
      storyPrefix: DEFAULT_CONFIG.storyPrefix,
    })

    const keys = envKeys(root)
    const missingEnv = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'].filter((k) => !keys.has(k) && !process.env[k])
    const written = !flags['dry-run']
    if (written) saveConfig(root, config)

    if (!this.jsonEnabled()) {
      this.log(written ? `Wrote ${path.relative(root, file)}` : 'Dry run: nothing written.')
      this.log(JSON.stringify(config, null, 2))
      if (missingEnv.length)
        this.log(`\nNot set yet (needed from Phase 6): ${missingEnv.join(', ')}. See .env.example.`)
      this.log('\nNext: agentia showtime doctor')
    }
    return {config, path: file, written, missingEnv}
  }
}
