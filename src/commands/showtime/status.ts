import {Args} from '@oclif/core'

import {projectRoot} from '../../config.js'
import {ShowtimeCommand} from '../../base-command.js'
import {listStories, showStatus, type ShowStatus} from '../../status.js'

export default class StatusCommand extends ShowtimeCommand {
  static override id = 'showtime:status'
  static override description =
    'Where each show is (lifecycle with times), what was decided, and whether Copado has the note.'
  static override args = {
    story: Args.string({description: 'Story name; omit to list every show', required: false}),
  }

  async run(): Promise<{shows: ShowStatus[]}> {
    const {args} = await this.parse(StatusCommand)
    const root = projectRoot()
    const shows = (args.story ? [args.story] : listStories(root)).map((s) => showStatus(root, s))
    if (!this.jsonEnabled()) {
      if (shows.length === 0) this.log('No shows yet. Start with `agentia showtime script <story>`.')
      for (const s of shows) {
        this.log(
          `${s.story}: ${s.state}${s.decision ? ` (${s.decision.kind.replace('_', ' ')} by ${s.decision.by}${s.secondsToDecision !== undefined ? `, ${Math.round(s.secondsToDecision / 60)} min after scripting` : ''}; Copado note ${s.decision.copado})` : ''}`,
        )
        if (s.decision?.comment) this.log(`   "${s.decision.comment}"`)
        for (const h of s.history) this.log(`   ${h.at}  ${h.state}${h.note ? `  ${h.note}` : ''}`)
      }
    }
    return {shows}
  }
}
