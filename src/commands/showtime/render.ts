import path from 'node:path'

import {Args, Flags} from '@oclif/core'

import {createAgentiaClient} from '../../agentia/client.js'
import {Copado} from '../../agentia/copado.js'
import {ShowtimeCommand} from '../../base-command.js'
import {loadConfig, projectRoot} from '../../config.js'
import type {RenderResult} from '../../edit/render.js'
import {PipelineError, renderStory} from '../../pipeline.js'

export default class RenderCommand extends ShowtimeCommand {
  static override id = 'showtime:render'
  static override description =
    'Narrate the script and build the demo video (1080p MP4 plus a small preview) from the recorded screens.'
  static override args = {story: Args.string({description: 'Story name (US-0000036)', required: true})}
  static override flags = {
    stills: Flags.boolean({
      description: 'Only write review stills (title, end and one per step); no narration or video',
    }),
    force: Flags.boolean({description: 'Re-render even if nothing changed'}),
  }

  async run(): Promise<RenderResult> {
    const {args, flags} = await this.parse(RenderCommand)
    const root = projectRoot()
    const loaded = loadConfig(root)
    if (!loaded.ok) this.error(`${loaded.message}. Run \`agentia showtime init\` first.`, {exit: 1})
    if (!this.jsonEnabled()) this.log(flags.stills ? 'Rendering review stills…' : 'Narrating and rendering…')
    let result: RenderResult
    try {
      result = await renderStory(
        {root, config: loaded.config, copado: new Copado(createAgentiaClient(root), root)},
        args.story,
        {stillsOnly: flags.stills, force: flags.force},
      )
    } catch (e) {
      if (e instanceof PipelineError) this.error(e.message, {exit: 1})
      throw e
    }
    if (!this.jsonEnabled()) {
      if (flags.stills) this.log(`Stills in ${path.relative(root, path.dirname(result.stills[2] ?? ''))}`)
      else
        this.log(
          `${result.reused ? 'Unchanged, reused' : 'Wrote'} ${path.relative(root, result.mp4)} (${result.seconds} s)\nPreview: ${path.relative(root, result.preview)}`,
        )
    }
    return result
  }
}
