import {Args, Flags} from '@oclif/core'

import {createAgentiaClient} from '../../agentia/client.js'
import {Copado} from '../../agentia/copado.js'
import {ShowtimeCommand} from '../../base-command.js'
import {loadConfig, projectRoot} from '../../config.js'
import {PipelineError, sendStory} from '../../pipeline.js'
import {reviewBlocks, reviewFallback} from '../../review/payloads.js'
import {renderedVideo, reviewInfo} from '../../review/send.js'
import {readScript} from '../../script/files.js'

export default class SendCommand extends ShowtimeCommand {
  static override id = 'showtime:send'
  static override description =
    'Post the demo video and the review card (Approve / Request changes) to the business owner in Slack.'
  static override args = {story: Args.string({description: 'Story name (US-0000036)', required: true})}
  static override flags = {
    'dry-run': Flags.boolean({
      description: 'Print the Slack message instead of sending it. Needs no tokens.',
    }),
  }

  async run(): Promise<Record<string, unknown>> {
    const {args, flags} = await this.parse(SendCommand)
    const root = projectRoot()
    const loaded = loadConfig(root)
    if (!loaded.ok) this.error(`${loaded.message}. Run \`agentia showtime init\` first.`, {exit: 1})
    const {config} = loaded

    if (flags['dry-run']) {
      const script = readScript(root, args.story)
      const info = reviewInfo(script, renderedVideo(root, args.story).seconds, config.uatUrl)
      const payload = {
        channel: config.slack.ownersChannel,
        text: reviewFallback(info),
        blocks: reviewBlocks(info),
      }
      if (!this.jsonEnabled()) this.log(JSON.stringify(payload, null, 2))
      return {dryRun: true, ...payload}
    }

    let record
    try {
      record = await sendStory(
        {root, config, copado: new Copado(createAgentiaClient(root), root)},
        args.story,
      )
    } catch (e) {
      if (e instanceof PipelineError) this.error(e.message, {exit: 1})
      throw e
    }
    if (!this.jsonEnabled())
      this.log(
        `Sent ${args.story} to ${config.slack.ownersChannel}. Run \`agentia showtime serve\` to receive the decision.`,
      )
    return {sent: true, channel: record.channel, ts: record.ts}
  }
}
