import {ShowtimeCommand} from '../../base-command.js'
import {createAgentiaClient} from '../../agentia/client.js'
import {Copado} from '../../agentia/copado.js'
import {loadConfig, projectRoot} from '../../config.js'
import {loadDotEnv} from '../../env.js'
import {startHub} from '../../review/hub.js'

export default class ServeCommand extends ShowtimeCommand {
  static override id = 'showtime:serve'
  static override description =
    'Start the Review Hub: listens in Slack (Socket Mode, no public URL) for Approve and Request changes, records the decision and writes it back to Copado.'
  static override enableJsonFlag = false

  async run(): Promise<void> {
    const root = projectRoot()
    const loaded = loadConfig(root)
    if (!loaded.ok) this.error(`${loaded.message}. Run \`agentia showtime init\` first.`, {exit: 1})
    loadDotEnv(root)
    const botToken = process.env.SLACK_BOT_TOKEN
    const appToken = process.env.SLACK_APP_TOKEN
    if (!botToken || !appToken)
      this.error('SLACK_BOT_TOKEN and SLACK_APP_TOKEN are needed. See docs/slack-setup.md.', {exit: 1})
    const hub = await startHub({
      root,
      config: loaded.config,
      copado: new Copado(createAgentiaClient(root), root),
      botToken,
      appToken,
      log: (l) => this.log(l),
    })
    await new Promise<void>((resolve) => {
      const stop = () => {
        void hub.stop().finally(resolve)
      }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
  }
}
