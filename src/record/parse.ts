import {XMLParser} from 'fast-xml-parser'

export interface RecordedStep {
  id: string
  ok: boolean
  /** Path inside the artifact archive, e.g. `screenshots/screenshot-X-<uuid>.png`. */
  screenshot?: string
}

type Node = Record<string, unknown>

/** Collects every <msg> text in document order from a preserveOrder parse. */
function messages(nodes: unknown, out: string[] = []): string[] {
  if (!Array.isArray(nodes)) return out
  for (const n of nodes as Node[]) {
    for (const [key, value] of Object.entries(n)) {
      if (key === 'msg') {
        const text = (value as Array<Record<string, unknown>>).map((t) => String(t['#text'] ?? '')).join('')
        out.push(text)
      } else if (key !== ':@') messages(value, out)
    }
  }
  return out
}

/**
 * Reads output.xml from a Robot run and returns one entry per marked step, in order.
 * The screenshot of a step is the last one logged between its START and END markers.
 */
export function parseOutput(xml: string): RecordedStep[] {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: true,
    trimValues: false,
    parseTagValue: false,
  })
  const msgs = messages(parser.parse(xml))
  const steps: RecordedStep[] = []
  let current: RecordedStep | undefined
  for (const raw of msgs) {
    const text = raw.trim()
    const start = /^SHOWTIME_STEP_START:(\S+)$/.exec(text)
    if (start) {
      current = {id: start[1] as string, ok: false}
      continue
    }
    const end = /^SHOWTIME_STEP:(\S+):(True|False)$/.exec(text)
    if (end && current && current.id === end[1]) {
      current.ok = end[2] === 'True'
      steps.push(current)
      current = undefined
      continue
    }
    const shot = /screenshots\/([^"\s<>]+\.(?:png|jpg|jpeg))/i.exec(text)
    if (shot && current) current.screenshot = `screenshots/${shot[1]}`
  }
  return steps
}
