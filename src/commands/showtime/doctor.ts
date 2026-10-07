import {createAgentiaClient} from '../../agentia/client.js'
import {ShowtimeCommand} from '../../base-command.js'
import {type Check, hasFailures, runDoctor} from '../../doctor.js'

const ICON = {ok: '✓', warn: '!', fail: '✗'} as const

export default class Doctor extends ShowtimeCommand {
  static override description =
    'Check sign-ins, ffmpeg, the narration voice, Slack tokens and config, with plain-English fixes.'
  static override examples = ['<%= config.bin %> <%= command.id %>']

  async run(): Promise<{checks: Check[]; ok: boolean}> {
    const root = process.cwd()
    const checks = await runDoctor({root, client: createAgentiaClient(root)})
    const ok = !hasFailures(checks)
    if (!this.jsonEnabled()) {
      for (const c of checks) {
        this.log(`${ICON[c.status]} ${c.label}: ${c.detail}`)
        if (c.status !== 'ok' && c.fix) this.log(`    → ${c.fix}`)
      }
      this.log(
        ok
          ? '\nAll required checks passed.'
          : '\nSome checks failed. Fix the ✗ items above and run doctor again.',
      )
    }
    if (!ok) process.exitCode = 1
    return {checks, ok}
  }
}
