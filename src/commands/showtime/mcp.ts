import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'

import {createAgentiaClient} from '../../agentia/client.js'
import {Copado} from '../../agentia/copado.js'
import {ShowtimeCommand} from '../../base-command.js'
import {loadConfig, projectRoot} from '../../config.js'
import {loadDotEnv} from '../../env.js'
import {buildServer} from '../../mcp/server.js'
import {realStages, scriptStory} from '../../pipeline.js'

export default class McpCommand extends ShowtimeCommand {
  static override id = 'showtime:mcp'
  static override description =
    "Start Showtime's own MCP server on stdio: showtime_status, showtime_feedback, showtime_script_preview, showtime_run. Register it with: claude mcp add showtime -- agentia showtime mcp"
  static override enableJsonFlag = false

  async run(): Promise<void> {
    const root = projectRoot()
    const loaded = loadConfig(root)
    // stdout carries the protocol, so every message goes to stderr.
    if (!loaded.ok)
      this.error(`${loaded.message}. Run \`agentia showtime init\` first (or set SHOWTIME_ROOT).`, {exit: 1})
    loadDotEnv(root)
    const {config} = loaded
    const copado = new Copado(createAgentiaClient(root), root)
    const ctx = {root, config, copado}
    const server = buildServer({
      root,
      config,
      stages: ({hint, noAi}) => realStages(ctx, {hint, noAi}),
      previewScript: (story, o) => scriptStory(ctx, story, {...o, dryRun: true}),
    })
    await server.connect(new StdioServerTransport())
    process.stderr.write(`Showtime MCP server ready (state in ${root})\n`)
  }
}
