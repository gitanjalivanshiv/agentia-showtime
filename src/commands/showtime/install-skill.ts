import path from 'node:path'

import {Flags} from '@oclif/core'

import {ShowtimeCommand} from '../../base-command.js'
import {projectRoot} from '../../config.js'
import {installSkill, type SkillTarget, updateInstructions, writeRootPointer} from '../../skill.js'

export default class InstallSkillCommand extends ShowtimeCommand {
  static override id = 'showtime:install-skill'
  static override description =
    'Copy the Showtime Agent Skill into a project, so a coding agent there knows when to run Showtime and how to read the business feedback.'
  static override flags = {
    dir: Flags.string({description: 'Project folder to install into (default: the current folder)'}),
    'no-instructions': Flags.boolean({
      description: 'Install the skill only; do not add the short note to AGENTS.md / CLAUDE.md',
    }),
    target: Flags.string({
      description: 'Which skills folder to use',
      options: ['agents', 'claude', 'cursor'],
      default: 'agents',
    }),
  }

  async run(): Promise<{installedTo: string; instructions?: string}> {
    const {flags} = await this.parse(InstallSkillCommand)
    const project = path.resolve(flags.dir ?? process.cwd())
    const dest = installSkill(project, flags.target as SkillTarget)
    const pointer = writeRootPointer(project, projectRoot())
    const instructions = flags['no-instructions']
      ? undefined
      : updateInstructions(project, flags.target as SkillTarget)
    if (!this.jsonEnabled()) {
      this.log(`Installed the Showtime skill in ${dest}`)
      if (pointer)
        this.log(
          `Wrote ${path.basename(pointer)}: Showtime commands run in ${path.basename(project)} will use the state in ${projectRoot()}`,
        )
      if (instructions)
        this.log(
          `Added a short Showtime note to ${path.basename(instructions)} (between <!-- showtime:start --> and <!-- showtime:end -->)`,
        )
    }
    return {installedTo: dest, ...(instructions ? {instructions} : {})}
  }
}
