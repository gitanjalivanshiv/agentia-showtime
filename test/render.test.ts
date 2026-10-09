import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {cardSegmentArgs, concatArgs, FPS, previewArgs, stepSegmentArgs} from '../src/edit/ffmpeg-cmd.js'
import {cardSeconds} from '../src/edit/render.js'
import {backgroundHtml, endCardHtml, esc, overlayHtml, titleCardHtml, WINDOW} from '../src/edit/templates.js'
import {introLine, narrate, OUTRO_LINE} from '../src/narrate/narrate.js'
import {parseDuration, type Tts} from '../src/narrate/tts.js'
import {parseScriptYaml} from '../src/script/generate.js'

const script = parseScriptYaml(
  fs.readFileSync(path.join(import.meta.dirname, '../examples/demo/script.fallback.yaml'), 'utf8'),
)

describe('ffmpeg command builders', () => {
  const seg = {
    bg: 'bg.png',
    shot: 's.png',
    overlay: 'o.png',
    audio: 'a.aiff',
    out: 'o.mp4',
    dur: 6,
    lead: 0.6,
  }
  it('builds a deterministic step segment with a slow zoom and delayed narration', () => {
    const args = stepSegmentArgs(seg)
    const filter = args[args.indexOf('-filter_complex') + 1] as string
    expect(filter).toContain(`zoompan=z='1+0.06*on/${6 * FPS}'`)
    expect(filter).toContain(`overlay=${WINDOW.x}:${WINDOW.y}`)
    expect(filter).toContain('adelay=600|600,apad=whole_dur=6.000')
    expect(args).toEqual(stepSegmentArgs(seg))
  })
  it('keeps timestamps and encoder strings out of the file so re-renders match', () => {
    const args = stepSegmentArgs(seg)
    expect(args).toContain('+bitexact')
    expect(args).toContain('-map_metadata')
    expect(args.join(' ')).toContain('-t 6.000')
  })
  it('builds card, concat and preview commands', () => {
    expect(
      cardSegmentArgs({card: 'c.png', audio: 'a.aiff', out: 'o.mp4', dur: 5, lead: 0.6}).join(' '),
    ).toContain('-i c.png')
    expect(concatArgs('list.txt', 'out.mp4').join(' ')).toContain('-f concat -safe 0 -i list.txt -c copy')
    expect(previewArgs('in.mp4', 'p.mp4').join(' ')).toContain('scale=960:540')
  })
})

describe('card templates', () => {
  it('escapes script text so a caption cannot inject markup', () => {
    expect(esc('<b>"x"</b> & y')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y')
    expect(overlayHtml('<script>alert(1)</script>', 1, 7)).not.toContain('<script>alert')
  })
  it('shows the step counter, caption and progress', () => {
    const html = overlayHtml('Open the case', 3, 7)
    expect(html).toContain('Step 3 of 7')
    expect(html).toContain('Open the case')
    expect(html).toContain('width:43%')
  })
  it('puts the feature and story on the title card, and the call to action on the end card', () => {
    expect(titleCardHtml({...script, story: {name: 'US-9', title: 't'}})).toContain('US-9')
    expect(titleCardHtml(script)).toContain('VIP Case Escalation')
    expect(endCardHtml(script)).toContain('Approve in Slack')
  })
  it('is deterministic and uses no external assets', () => {
    expect(backgroundHtml()).toBe(backgroundHtml())
    for (const html of [
      backgroundHtml(),
      titleCardHtml(script),
      endCardHtml(script),
      overlayHtml('x', 1, 2),
    ]) {
      expect(html).not.toMatch(/https?:\/\//)
    }
  })
})

describe('narration', () => {
  let dir: string
  beforeEach(() => void (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'showtime-nar-'))))
  afterEach(() => fs.rmSync(dir, {recursive: true, force: true}))

  const makeTts = () => {
    const spoken: string[] = []
    const tts: Tts = {
      name: 'fake',
      synth: async (text, file) => {
        spoken.push(text)
        fs.writeFileSync(file, 'audio')
      },
    }
    return {tts, spoken}
  }

  it('speaks an intro, every step and an outro, in order', async () => {
    const {tts, spoken} = makeTts()
    const clips = await narrate(script, {dir, tts, seconds: async () => 3})
    expect(spoken).toEqual([introLine(script), ...script.steps.map((s) => s.narration), OUTRO_LINE])
    expect(clips.map((c) => c.id)).toEqual(['title', ...script.steps.map((s) => s.id), 'end'])
  })
  it('reuses unchanged clips and re-speaks only changed lines', async () => {
    const first = makeTts()
    await narrate(script, {dir, tts: first.tts, seconds: async () => 3})
    const second = makeTts()
    await narrate(script, {dir, tts: second.tts, seconds: async () => 3})
    expect(second.spoken).toEqual([])
    const edited = {
      ...script,
      steps: script.steps.map((s, i) => (i === 2 ? {...s, narration: 'A brand new line for you.'} : s)),
    }
    const third = makeTts()
    await narrate(edited, {dir, tts: third.tts, seconds: async () => 3})
    expect(third.spoken).toEqual(['A brand new line for you.'])
  })
  it('reads durations from the ffmpeg banner', () => {
    expect(parseDuration('  Duration: 00:01:02.50, start: 0.0')).toBeCloseTo(62.5)
    expect(() => parseDuration('nothing')).toThrow()
  })
})

describe('card timing', () => {
  it('holds a step long enough to read, and longer when the narration is long', () => {
    expect(cardSeconds({id: 'a', text: '', file: '', seconds: 2}, true)).toBe(7.5)
    expect(cardSeconds({id: 'a', text: '', file: '', seconds: 10}, true)).toBeCloseTo(11.6)
    expect(cardSeconds({id: 'title', text: '', file: '', seconds: 2}, false)).toBe(5)
  })
})
