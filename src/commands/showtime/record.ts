import path from 'node:path'

import {Args, Flags} from '@oclif/core'

import {createAgentiaClient} from '../../agentia/client.js'
import {Copado} from '../../agentia/copado.js'
import {ShowtimeCommand} from '../../base-command.js'
import {loadConfig, projectRoot} from '../../config.js'
import {LockBusyError} from '../../lock.js'
import {recordStory} from '../../pipeline.js'
import type {Recording} from '../../record/record.js'
import {writeRobotFile} from '../../record/record.js'
import {readScript} from '../../script/files.js'

export default class RecordCommand extends ShowtimeCommand {
  static override id = 'showtime:record'
  static override description =
    'Run the demo script in the UAT org with Robotic Testing and save one clean screenshot per step.'
  static override args = {story: Args.string({description: 'Story name (US-0000036)', required: true})}
  static override flags = {
    'dry-run': Flags.boolean({description: 'Write the Robot file only; do not upload or run anything'}),
  }

  async run(): Promise<{robot: string; recording?: Recording}> {
    const {args, flags} = await this.parse(RecordCommand)
    const root = projectRoot()
    const loaded = loadConfig(root)
    if (!loaded.ok) this.error(`${loaded.message}. Run \`agentia showtime init\` first.`, {exit: 1})
    const {config} = loaded

    if (flags['dry-run']) {
      const robot = writeRobotFile(root, readScript(root, args.story))
      if (!this.jsonEnabled()) this.log(`Wrote ${path.relative(root, robot)}. Nothing was uploaded or run.`)
      return {robot}
    }
    if (!this.jsonEnabled()) this.log(`Recording in ${config.uatEnvironment} (about a minute)…`)
    let recording: Recording
    try {
      recording = await recordStory(
        {root, config, copado: new Copado(createAgentiaClient(root), root)},
        args.story,
        (l) => this.jsonEnabled() || this.log(l),
      )
    } catch (e) {
      if (e instanceof LockBusyError) this.error(e.message, {exit: 2})
      throw e
    }
    if (!this.jsonEnabled()) {
      for (const s of recording.steps)
        this.log(`${s.ok && s.frame ? '✓' : '✗'} ${s.id}${s.frame ? `  ${s.frame}` : '  (no screenshot)'}`)
      this.log(
        recording.failed.length
          ? `\n${recording.failed.length} step(s) failed: ${recording.failed.join(', ')}. See .showtime/shows/${args.story}/artifacts.zip (log.html).`
          : '\nAll steps recorded.',
      )
    }
    if (recording.failed.length) process.exitCode = 1
    return {robot: path.join('.showtime/shows', args.story, 'session.robot'), recording}
  }
}
