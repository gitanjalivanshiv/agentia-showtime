import {parse as parseYaml} from 'yaml'

import type {Story} from '../agentia/copado.js'
import {type DemoScript, scriptSchema} from './schema.js'

export type Ask = (prompt: string) => Promise<string>

export function buildPrompt(story: Story, uatEnvironment: string, hint?: string): string {
  const lines = [
    'You write short product demo scripts for a Salesforce Lightning feature that is ready for business sign-off.',
    'A robot will perform the steps in a browser, so every step must be something a user does in the Lightning UI,',
    'using only visible labels, record names and page names. No CSS selectors, no code, no setup or admin work.',
    '',
    `Story ${story.name}: ${story.title}`,
    story.asA && `As a: ${story.asA}`,
    story.wantTo && `I want to: ${story.wantTo}`,
    story.soThat && `So that: ${story.soThat}`,
    story.acceptanceCriteria && `Acceptance criteria: ${story.acceptanceCriteria}`,
    `The feature is deployed in the ${uatEnvironment} sandbox.`,
    hint && `Test data and hints: ${hint}`,
    '',
    'Return ONLY one JSON object, no markdown, in exactly this shape:',
    '{"feature":"<=80 chars, plain title","summary":["2-3 short bullets: what the business should check"],',
    ' "steps":[{"id":"kebab-case-id","action":"navigate|click|type|verify|wait","target":"visible label or page",',
    '  "value":"text to type or text that must be visible (optional)","caption":"<=70 chars shown on screen",',
    '  "narration":"warm, plain English, second person, at most 20 words"}]}',
    'Use 4 to 7 steps. Cover the acceptance criteria and finish with a verify step that shows the result.',
    'Target is the exact visible name of a button, field label, record or page (for example "New Case" or',
    '"Accounts"), never a description such as "the account page". Open records by their exact name.',
    'Narration is a friendly guide describing what the viewer sees and what changed for their team',
    '("Here is your VIP customer..."). Never give commands like "Click" or "Type". No jargon.',
  ]
  return lines.filter((l): l is string => typeof l === 'string').join('\n')
}

/** Models wrap JSON in fences or prose. Take the outermost {...}. */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object found in the AI answer')
  return JSON.parse(cleaned.slice(start, end + 1))
}

function describeIssues(e: unknown): string {
  if (e && typeof e === 'object' && 'issues' in e) {
    return (e as {issues: Array<{path: PropertyKey[]; message: string}>}).issues
      .slice(0, 6)
      .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
      .join('; ')
  }
  return e instanceof Error ? e.message : String(e)
}

export interface GenerateResult {
  script?: DemoScript
  attempts: number
  /** Why AI output was rejected, one entry per failed attempt. Empty when the first answer was good. */
  problems: string[]
}

/** Asks up to twice: the second prompt includes what was wrong with the first answer. */
export async function generateScript(
  story: Story,
  ask: Ask,
  uatEnvironment: string,
  hint?: string,
): Promise<GenerateResult> {
  const problems: string[] = []
  let prompt = buildPrompt(story, uatEnvironment, hint)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = extractJson(await ask(prompt)) as Record<string, unknown>
      const script = scriptSchema.parse({
        ...raw,
        version: 1,
        story: {name: story.name, title: story.title},
        source: 'ai',
      })
      return {script, attempts: attempt, problems}
    } catch (e) {
      const why = describeIssues(e)
      problems.push(why)
      prompt = `${buildPrompt(story, uatEnvironment, hint)}\n\nYour previous answer was rejected: ${why}. Fix exactly that and return only the JSON.`
    }
  }
  return {attempts: 2, problems}
}

export function parseScriptYaml(text: string, source?: DemoScript['source']): DemoScript {
  const raw = parseYaml(text) as Record<string, unknown>
  return scriptSchema.parse(source ? {...raw, source} : raw)
}
