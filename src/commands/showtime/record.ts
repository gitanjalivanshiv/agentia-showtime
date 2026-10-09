import path from 'node:path'

import {Args, Flags} from '@oclif/core'

import {createAgentiaClient} from '../../agentia/client.js'
import {Copado} from '../../agentia/copado.js'
import {ShowtimeCommand} from '../../base-command.js'
import {loadConfig} from '../../config.js'
import {LockBusyError, withOrgLock} from '../../lock.js'
import {getFrontdoorUrl} from '../../record/frontdoor.js'
import {recordShow, type Recording, writeRobotFile} from '../../record/record.js'
import {readScript} from '../../script/files.js'
import {transition} from '../../store/lifecycle.js'

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
    const root = process.cwd()
    const loaded = loadConfig(root)
    if (!loaded.ok) this.error(`${loaded.message}. Run \`agentia showtime init\` first.`, {exit: 1})
    const {config} = loaded
    if (config.crtJobId === undefined)
      this.error('No crtJobId in the config. Run `agentia showtime init --force`.', {exit: 1})
    const script = readScript(root, args.story)

    if (flags['dry-run']) {
      const robot = writeRobotFile(root, script)
      if (!this.jsonEnabled()) this.log(`Wrote ${path.relative(root, robot)}. Nothing was uploaded or run.`)
      return {robot}
    }

    const copado = new Copado(createAgentiaClient(root), root)
    const robot = writeRobotFile(root, script)
    if (!this.jsonEnabled())
      this.log(`Recording ${script.steps.length} steps in ${config.uatEnvironment} (about a minute)…`)
    let recording: Recording
    try {
      recording = await withOrgLock(`record ${args.story} (CRT upload and run)`, () =>
        recordShow({
          root,
          script,
          copado,
          crtProjectId: config.crtProjectId,
          crtJobId: config.crtJobId as number,
          frontdoor: () => getFrontdoorUrl(config.sfAlias),
        }),
      )
    } catch (e) {
      if (e instanceof LockBusyError) this.error(e.message, {exit: 2})
      throw e
    }

    if (recording.failed.length === 0)
      transition(root, args.story, 'recorded', `build=${recording.buildId ?? '?'}`)
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
    return {robot, recording}
  }
}
