import {WINDOW} from './templates.js'

/** Pure builders for the ffmpeg command lines, so they can be tested without running ffmpeg. */

export const FPS = 30
const ENCODE = [
  '-c:v',
  'libx264',
  '-crf',
  '18',
  '-preset',
  'medium',
  '-pix_fmt',
  'yuv420p',
  '-r',
  String(FPS),
  '-c:a',
  'aac',
  '-b:a',
  '160k',
  '-ar',
  '44100',
  '-ac',
  '2',
  // Same inputs, same bytes: no timestamps or encoder version in the file.
  '-fflags',
  '+bitexact',
  '-flags:v',
  '+bitexact',
  '-map_metadata',
  '-1',
  '-movflags',
  '+faststart',
]

const audioChain = (index: number, lead: number, dur: number) =>
  `[${index}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${Math.round(lead * 1000)}|${Math.round(lead * 1000)},apad=whole_dur=${dur.toFixed(3)}[a]`

export interface StepSegment {
  bg: string
  shot: string
  overlay: string
  audio: string
  out: string
  /** Seconds this card is on screen. */
  dur: number
  /** Silence before the narration starts, seconds. */
  lead: number
}

/** Background + still screenshot + caption layer + narration. No zoom: it cropped the edges and read as a glitch. */
export function stepSegmentArgs(s: StepSegment): string[] {
  const {x, y, w, h} = WINDOW
  const filter = [
    `[1:v]scale=${w}:${h}:flags=lanczos[z]`,
    `[0:v][z]overlay=${x}:${y}:shortest=1[b]`,
    `[b][2:v]overlay=0:0:shortest=1,format=yuv420p[v]`,
    audioChain(3, s.lead, s.dur),
  ].join(';')
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-loop',
    '1',
    '-framerate',
    String(FPS),
    '-t',
    s.dur.toFixed(3),
    '-i',
    s.bg,
    '-loop',
    '1',
    '-framerate',
    String(FPS),
    '-t',
    s.dur.toFixed(3),
    '-i',
    s.shot,
    '-loop',
    '1',
    '-framerate',
    String(FPS),
    '-t',
    s.dur.toFixed(3),
    '-i',
    s.overlay,
    '-i',
    s.audio,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-t',
    s.dur.toFixed(3),
    ...ENCODE,
    s.out,
  ]
}

export interface CardSegment {
  card: string
  audio: string
  out: string
  dur: number
  lead: number
}

/** Title and end cards: one still image with narration. */
export function cardSegmentArgs(s: CardSegment): string[] {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-loop',
    '1',
    '-framerate',
    String(FPS),
    '-t',
    s.dur.toFixed(3),
    '-i',
    s.card,
    '-i',
    s.audio,
    '-filter_complex',
    `[0:v]format=yuv420p[v];${audioChain(1, s.lead, s.dur)}`,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-t',
    s.dur.toFixed(3),
    ...ENCODE,
    s.out,
  ]
}

export function concatArgs(listFile: string, out: string): string[] {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    '-fflags',
    '+bitexact',
    '-map_metadata',
    '-1',
    out,
  ]
}

/** Small copy for quick previews and Slack's muted autoplay. */
export function previewArgs(input: string, out: string): string[] {
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input,
    '-vf',
    'scale=960:540',
    '-c:v',
    'libx264',
    '-crf',
    '28',
    '-preset',
    'medium',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-fflags',
    '+bitexact',
    '-flags:v',
    '+bitexact',
    '-map_metadata',
    '-1',
    '-movflags',
    '+faststart',
    out,
  ]
}

/** A single composite frame of a step (no zoom), for design review. */
export function stepStillArgs(s: {bg: string; shot: string; overlay: string; out: string}): string[] {
  const {x, y, w, h} = WINDOW
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    s.bg,
    '-i',
    s.shot,
    '-i',
    s.overlay,
    '-filter_complex',
    `[1:v]scale=${w}:${h}[z];[0:v][z]overlay=${x}:${y}[b];[b][2:v]overlay=0:0`,
    '-frames:v',
    '1',
    s.out,
  ]
}
