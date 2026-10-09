import {Args, Flags} from '@oclif/core'
import {WebClient} from '@slack/web-api'

import {ShowtimeCommand} from '../../base-command.js'
import {loadConfig} from '../../config.js'
import {loadDotEnv} from '../../env.js'
import {reviewBlocks, reviewFallback} from '../../review/payloads.js'
import {renderedVideo, reviewInfo, sendReview} from '../../review/send.js'
import {WebGateway, type WebClientLike} from '../../review/slack.js'
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
    const root = process.cwd()
    const loaded = loadConfig(root)
    if (!loaded.ok) this.error(`${loaded.message}. Run \`agentia showtime init\` first.`, {exit: 1})
    const {config} = loaded
    const script = readScript(root, args.story)

    if (flags['dry-run']) {
      const info = reviewInfo(script, renderedVideo(root, args.story).seconds, config.uatUrl)
      const payload = {
        channel: config.slack.ownersChannel,
        text: reviewFallback(info),
        blocks: reviewBlocks(info),
      }
      if (!this.jsonEnabled()) this.log(JSON.stringify(payload, null, 2))
      return {dryRun: true, ...payload}
    }

    loadDotEnv(root)
    const token = process.env.SLACK_BOT_TOKEN
    if (!token)
      this.error('SLACK_BOT_TOKEN is not set. Follow docs/slack-setup.md, then add it to .env.', {exit: 1})
    const gateway = new WebGateway(new WebClient(token) as unknown as WebClientLike)
    const record = await sendReview({
      root,
      script,
      gateway,
      ownersChannel: config.slack.ownersChannel,
      releaseChannel: config.slack.releaseChannel,
      uatUrl: config.uatUrl,
    })
    if (!this.jsonEnabled())
      this.log(
        `Sent ${args.story} to ${config.slack.ownersChannel}. Run \`agentia showtime serve\` to receive the decision.`,
      )
    return {sent: true, channel: record.channel, ts: record.ts}
  }
}
