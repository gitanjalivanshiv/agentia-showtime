import {execa} from 'execa'

import {resolveFfmpeg} from '../util/ffmpeg.js'

/** A text-to-speech provider. `say` is the default (offline, free); others plug in behind the same shape. */
export interface Tts {
  readonly name: string
  /** Writes speech for `text` to `file` (any format ffmpeg can read). */
  synth(text: string, file: string): Promise<void>
}

export class SayTts implements Tts {
  readonly name = 'macOS say'
  constructor(
    private readonly voice: string,
    private readonly rate: number,
  ) {}

  async synth(text: string, file: string): Promise<void> {
    const r = await execa('say', ['-v', this.voice, '-r', String(this.rate), '-o', file, '--', text], {
      reject: false,
      timeout: 60_000,
    })
    if (r.failed)
      throw new Error(`\`say\` failed for voice "${this.voice}": ${String(r.stderr).slice(0, 200)}`)
  }
}

/** Duration in seconds, read from ffmpeg's banner (ffmpeg-static ships no ffprobe). */
export async function audioSeconds(file: string, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const ff = await resolveFfmpeg(env)
  if (!ff) throw new Error('ffmpeg not found')
  const r = await execa(ff.path, ['-hide_banner', '-i', file], {reject: false, timeout: 30_000})
  return parseDuration(String(r.stderr))
}

export function parseDuration(banner: string): number {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(banner)
  if (!m) throw new Error('could not read the audio duration')
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}
