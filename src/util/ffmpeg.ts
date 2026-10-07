import {createRequire} from 'node:module'

import {execa} from 'execa'

export interface FfmpegInfo {
  path: string
  source: 'SHOWTIME_FFMPEG' | 'PATH' | 'ffmpeg-static'
  version: string
}

async function versionOf(bin: string): Promise<string | undefined> {
  const r = await execa(bin, ['-version'], {reject: false, timeout: 15_000})
  if (r.failed || typeof r.stdout !== 'string') return undefined
  return /ffmpeg version (\S+)/.exec(r.stdout)?.[1]
}

/** Resolution order (docs/decisions.md D1): env override, system ffmpeg, bundled ffmpeg-static. */
export async function resolveFfmpeg(env: NodeJS.ProcessEnv = process.env): Promise<FfmpegInfo | undefined> {
  const candidates: Array<Omit<FfmpegInfo, 'version'>> = []
  if (env.SHOWTIME_FFMPEG) candidates.push({path: env.SHOWTIME_FFMPEG, source: 'SHOWTIME_FFMPEG'})
  candidates.push({path: 'ffmpeg', source: 'PATH'})
  try {
    const bundled = createRequire(import.meta.url)('ffmpeg-static') as string | null
    if (bundled) candidates.push({path: bundled, source: 'ffmpeg-static'})
  } catch {
    // package missing: fall through
  }
  for (const c of candidates) {
    const version = await versionOf(c.path)
    if (version) return {...c, version}
  }
  return undefined
}
