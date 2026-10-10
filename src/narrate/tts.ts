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

/**
 * Silent narration of the right length, for machines without a voice (Linux CI, judges' laptops).
 * The video still has its captions and timing; it just has no speech.
 */
export class SilentTts implements Tts {
  readonly name = 'silent'
  constructor(private readonly ffmpeg: string) {}

  async synth(text: string, file: string): Promise<void> {
    const seconds = Math.max(1, speechSeconds(text))
    const r = await execa(
      this.ffmpeg,
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=22050:cl=mono',
        '-t',
        seconds.toFixed(2),
        '-f',
        'aiff',
        file,
      ],
      {reject: false, timeout: 30_000},
    )
    if (r.failed) throw new Error(`Could not make silent audio: ${String(r.stderr).slice(0, 200)}`)
  }
}

/** About 160 words a minute, the pace of the default voice. */
export const speechSeconds = (text: string) => (text.trim().split(/\s+/).filter(Boolean).length / 160) * 60

export async function sayAvailable(): Promise<boolean> {
  const r = await execa('say', ['-v', '?'], {reject: false, timeout: 15_000}).catch(() => undefined)
  return Boolean(r && !r.failed)
}

/** `SHOWTIME_TTS=silent` forces silence; otherwise the macOS voice when there is one, else silence. */
export async function chooseTts(
  voice: {name: string; rate: number},
  ffmpeg: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Tts> {
  if (env.SHOWTIME_TTS === 'silent' || !(await sayAvailable())) return new SilentTts(ffmpeg)
  return new SayTts(voice.name, voice.rate)
}
