import path from 'node:path'

import {Args, Flags} from '@oclif/core'

import {createAgentiaClient} from '../../agentia/client.js'
import {Copado} from '../../agentia/copado.js'
import {ShowtimeCommand} from '../../base-command.js'
import {loadConfig, projectRoot} from '../../config.js'
import {PipelineError, scriptStory, type ScriptResult} from '../../pipeline.js'
import {toYaml} from '../../script/files.js'
import {execa} from 'execa'

export default class ScriptCommand extends ShowtimeCommand {
  static override id = 'showtime:script'
  static override description =
    'Turn a story into a demo script (steps plus one narration line each). Copado AI writes it; the result is checked against a schema, with a hand-written fallback.'
  static override args = {story: Args.string({description: 'Story name (US-0000036) or ID', required: true})}
  static override flags = {
    edit: Flags.boolean({description: 'Open the script in $EDITOR afterwards'}),
    'dry-run': Flags.boolean({description: 'Show the script without writing it'}),
    'no-ai': Flags.boolean({description: 'Skip Copado AI and use the fallback script'}),
    fallback: Flags.string({description: 'Fallback script file to use when AI fails (or with --no-ai)'}),
    hint: Flags.string({
      description: 'Exact record names and field labels for the AI to use (or .showtime/hints/<story>.txt)',
    }),
  }

  async run(): Promise<ScriptResult> {
    const {args, flags} = await this.parse(ScriptCommand)
    const root = projectRoot()
    const loaded = loadConfig(root)
    if (!loaded.ok) this.error(`${loaded.message}. Run \`agentia showtime init\` first.`, {exit: 1})
    const say = (l: string) => (this.jsonEnabled() ? undefined : this.log(l))
    let r: ScriptResult
    try {
      r = await scriptStory(
        {root, config: loaded.config, copado: new Copado(createAgentiaClient(root), root)},
        args.story,
        {noAi: flags['no-ai'], fallback: flags.fallback, hint: flags.hint, dryRun: flags['dry-run']},
        say,
      )
    } catch (e) {
      if (e instanceof PipelineError) this.error(e.message, {exit: 1})
      throw e
    }
    if (!this.jsonEnabled()) {
      this.log(
        flags['dry-run']
          ? toYaml(r.script)
          : `Wrote ${path.relative(root, r.path ?? '')} (${r.script.steps.length} steps, about ${r.seconds} s of narration, source: ${r.script.source})`,
      )
      if (r.seconds < 45 || r.seconds > 100)
        this.warn(
          `Estimated narration length ${r.seconds} s is outside the 60–90 s target once pauses are added. Add or trim steps.`,
        )
    }
    if (flags.edit && r.path && !flags['dry-run'])
      await execa(process.env.EDITOR ?? 'nano', [r.path], {stdio: 'inherit', reject: false})
    return r
  }
}
