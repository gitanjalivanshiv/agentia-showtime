import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {Args, Flags} from '@oclif/core'
import {execa} from 'execa'

import {createAgentiaClient} from '../../agentia/client.js'
import {Copado} from '../../agentia/copado.js'
import {ShowtimeCommand} from '../../base-command.js'
import {loadConfig} from '../../config.js'
import {scriptPath, toYaml, writeScript} from '../../script/files.js'
import {generateScript, parseScriptYaml} from '../../script/generate.js'
import {type DemoScript, estimateSeconds} from '../../script/schema.js'
import {transition} from '../../store/lifecycle.js'

const BUNDLED_FALLBACK = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../examples/demo/script.fallback.yaml',
)

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
    hint: Flags.string({description: 'Test data or hints for the AI, e.g. a record name to use'}),
  }

  async run(): Promise<{script: DemoScript; path?: string; seconds: number; problems: string[]}> {
    const {args, flags} = await this.parse(ScriptCommand)
    const root = process.cwd()
    const loaded = loadConfig(root)
    if (!loaded.ok) this.error(`${loaded.message}. Run \`agentia showtime init\` first.`, {exit: 1})
    const copado = new Copado(createAgentiaClient(root), root)
    const story = await copado.getStory(args.story)

    let script: DemoScript | undefined
    let problems: string[] = []
    if (!flags['no-ai']) {
      this.logIf('Asking Copado AI for a demo script…')
      const r = await generateScript(
        story,
        (p) => copado.ask('plan', p),
        loaded.config.uatEnvironment,
        flags.hint,
      )
      script = r.script
      problems = r.problems
      if (!script) this.logIf(`Copado AI's answer was not usable (${problems.at(-1)}). Trying the fallback.`)
    }
    if (!script) {
      const file = flags.fallback ?? (fs.existsSync(BUNDLED_FALLBACK) ? BUNDLED_FALLBACK : undefined)
      if (!file) this.error('No usable AI script and no fallback file. Pass --fallback <file>.', {exit: 1})
      const fb = parseScriptYaml(fs.readFileSync(file, 'utf8'), 'fallback')
      // The bundled fallback only fits its own story; a different story needs the user's own file.
      if (!flags.fallback && fb.story.title !== story.title) {
        this.error(
          `The bundled fallback is for "${fb.story.title}", not "${story.title}". Pass --fallback <file>.`,
          {exit: 1},
        )
      }
      script = {...fb, story: {name: story.name, title: story.title}}
    }

    const seconds = estimateSeconds(script)
    let written: string | undefined
    if (!flags['dry-run']) {
      written = writeScript(root, script)
      transition(root, story.name, 'scripted', `source=${script.source}`)
    }
    if (!this.jsonEnabled()) {
      this.log(
        flags['dry-run']
          ? toYaml(script)
          : `Wrote ${path.relative(root, written ?? scriptPath(root, story.name))} (${script.steps.length} steps, about ${seconds} s of narration, source: ${script.source})`,
      )
      if (seconds < 45 || seconds > 100)
        this.warn(`Estimated length ${seconds} s is outside the 60–90 s target. Add or trim steps.`)
    }
    if (flags.edit && written) {
      await execa(process.env.EDITOR ?? 'nano', [written], {stdio: 'inherit', reject: false})
    }
    return {script, path: written, seconds, problems}
  }

  private logIf(msg: string) {
    if (!this.jsonEnabled()) this.log(msg)
  }
}
