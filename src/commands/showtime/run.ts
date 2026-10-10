import {Args, Flags} from '@oclif/core'

import {createAgentiaClient} from '../../agentia/client.js'
import {Copado} from '../../agentia/copado.js'
import {ShowtimeCommand} from '../../base-command.js'
import {loadConfig, projectRoot} from '../../config.js'
import {PipelineError, realStages, runPipeline, type RunResult, type StageName} from '../../pipeline.js'
import {LockBusyError} from '../../lock.js'

export default class RunCommand extends ShowtimeCommand {
  static override id = 'showtime:run'
  static override description =
    'The demo command: script → record → render → send, one progress line per stage. Records in the UAT org and posts to Slack.'
  static override args = {story: Args.string({description: 'Story name (US-0000036)', required: true})}
  static override flags = {
    'skip-send': Flags.boolean({description: 'Stop after the video; do not post to Slack'}),
    from: Flags.string({
      description: 'Start at this stage and reuse earlier results',
      options: ['script', 'record', 'render', 'send'],
    }),
    'no-ai': Flags.boolean({description: 'Use the fallback script instead of Copado AI'}),
    fallback: Flags.string({description: 'Fallback script file'}),
    hint: Flags.string({description: 'Exact record names and field labels for the AI'}),
    'dry-run': Flags.boolean({description: 'Show what would happen without doing any of it'}),
  }

  async run(): Promise<RunResult | {plan: string[]}> {
    const {args, flags} = await this.parse(RunCommand)
    const root = projectRoot()
    const loaded = loadConfig(root)
    if (!loaded.ok) this.error(`${loaded.message}. Run \`agentia showtime init\` first.`, {exit: 1})
    const {config} = loaded

    if (flags['dry-run']) {
      const plan = [
        `script: ask Copado AI for steps and narration for ${args.story} (writes .showtime only)`,
        `record: upload a Robot file to the "Showtime Recorder" CRT job and run it in ${config.uatEnvironment} (writes to Robotic Testing; takes the shared lock)`,
        'render: narrate with the macOS voice and build the MP4 (local only)',
        ...(flags['skip-send']
          ? []
          : [`send: post the video and review card to ${config.slack.ownersChannel} in Slack`]),
      ]
      if (!this.jsonEnabled()) for (const p of plan) this.log(`• ${p}`)
      return {plan}
    }

    const say = (l: string) => (this.jsonEnabled() ? undefined : this.log(l))
    const stages = realStages(
      {root, config, copado: new Copado(createAgentiaClient(root), root)},
      {noAi: flags['no-ai'], fallback: flags.fallback, hint: flags.hint, say},
    )
    try {
      const result = await runPipeline(stages, args.story, {
        skipSend: flags['skip-send'],
        from: flags.from as StageName | undefined,
        progress: say,
      })
      say(
        flags['skip-send']
          ? '\nVideo ready. Not sent (--skip-send).'
          : `\nSent to ${config.slack.ownersChannel}. Start \`agentia showtime serve\` to receive the decision.`,
      )
      return result
    } catch (e) {
      if (e instanceof PipelineError) {
        if (e.cause instanceof LockBusyError) this.error(`${e.message}`, {exit: 2})
        this.error(`${e.stage} failed: ${e.message}`, {exit: 1})
      }
      throw e
    }
  }
}
