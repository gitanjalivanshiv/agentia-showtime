import path from 'node:path'

import {Args, Flags} from '@oclif/core'

import {ShowtimeCommand} from '../../base-command.js'
import {loadConfig} from '../../config.js'
import {renderShow, type RenderResult} from '../../edit/render.js'
import {SayTts} from '../../narrate/tts.js'
import {readScript} from '../../script/files.js'
import {transition} from '../../store/lifecycle.js'
import {resolveFfmpeg} from '../../util/ffmpeg.js'

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
    const root = process.cwd()
    const loaded = loadConfig(root)
    if (!loaded.ok) this.error(`${loaded.message}. Run \`agentia showtime init\` first.`, {exit: 1})
    const ffmpeg = await resolveFfmpeg()
    if (!ffmpeg) this.error('ffmpeg was not found. Run `agentia showtime doctor`.', {exit: 1})
    const script = readScript(root, args.story)
    const tts = new SayTts(loaded.config.voice.name, loaded.config.voice.rate)

    if (!this.jsonEnabled())
      this.log(
        flags.stills ? 'Rendering review stills…' : `Narrating and rendering ${script.steps.length} steps…`,
      )
    const result = await renderShow({
      root,
      script,
      tts,
      ffmpeg: ffmpeg.path,
      stillsOnly: flags.stills,
      force: flags.force,
    })
    if (!flags.stills && !result.reused) {
      transition(root, args.story, 'narrated', `voice=${loaded.config.voice.name}`)
      transition(root, args.story, 'rendered', `hash=${result.hash.slice(0, 12)}`)
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
