import {Command} from '@oclif/core'

/** `--json` on every command (brief §6). */
export abstract class ShowtimeCommand extends Command {
  static override enableJsonFlag = true
}
