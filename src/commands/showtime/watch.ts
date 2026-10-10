import {Flags} from '@oclif/core'

import {createAgentiaClient} from '../../agentia/client.js'
import {Copado} from '../../agentia/copado.js'
import {ShowtimeCommand} from '../../base-command.js'
import {loadConfig, projectRoot} from '../../config.js'
import {realStages} from '../../pipeline.js'
import {watchOnce, type WatchOnceResult} from '../../watch.js'

export default class WatchCommand extends ShowtimeCommand {
  static override id = 'showtime:watch'
  static override description =
    'Poll Copado and run a show automatically when a "Showtime Demo –" story reaches the UAT environment (or comes back after changes were requested).'
  static override flags = {
    once: Flags.boolean({description: 'Poll one time and exit'}),
    interval: Flags.integer({description: 'Seconds between polls', default: 60, min: 10}),
    'dry-run': Flags.boolean({description: 'Report what would run; run nothing'}),
    max: Flags.integer({description: 'Most stories to run per poll', default: 5, min: 1}),
  }

  async run(): Promise<WatchOnceResult | void> {
    const {flags} = await this.parse(WatchCommand)
    const root = projectRoot()
    const loaded = loadConfig(root)
    if (!loaded.ok) this.error(`${loaded.message}. Run \`agentia showtime init\` first.`, {exit: 1})
    const {config} = loaded
    const copado = new Copado(createAgentiaClient(root), root)
    const log = (l: string) =>
      this.jsonEnabled() ? undefined : this.log(`${new Date().toISOString().slice(11, 19)} ${l}`)
    const stages = realStages({root, config, copado}, {say: log})
    const poll = async () => {
      try {
        const r = await watchOnce({
          root,
          config,
          copado,
          stages,
          log,
          dryRun: flags['dry-run'],
          max: flags.max,
        })
        if (r.found.length === 0) log(`no story is waiting in ${config.uatEnvironment}`)
        return r
      } catch (e) {
        log(`poll failed: ${e instanceof Error ? e.message : String(e)}`)
        return undefined
      }
    }
    if (flags.once || flags['dry-run']) return (await poll()) ?? {found: [], ran: [], failed: [], waiting: []}
    log(
      `Watching ${config.uatEnvironment} every ${flags.interval} s for "${config.storyPrefix}" stories. Press Ctrl+C to stop.`,
    )
    let stopped = false
    const stop = () => {
      stopped = true
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    while (!stopped) {
      await poll()
      for (let i = 0; i < flags.interval && !stopped; i++) await new Promise((r) => setTimeout(r, 1000))
    }
  }
}
