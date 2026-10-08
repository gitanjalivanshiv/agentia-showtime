import {z} from 'zod'

/** Verbs the recorder (Phase 4) knows how to turn into Robot Framework keywords. */
export const ACTIONS = ['navigate', 'click', 'type', 'verify', 'wait'] as const

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

export const stepSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'use lowercase letters, digits and dashes')
    .min(1),
  action: z.enum(ACTIONS),
  /** What the robot looks for: a visible label, a record name or a page. Never a CSS selector. */
  target: z.string().min(1).max(120),
  /** Text to type, or text that must be visible for `verify`. */
  value: z.string().max(200).optional(),
  /** On-screen caption (burned into the video). */
  caption: z.string().min(1).max(70),
  /** What the narrator says for this step. Warm, second person, about 20 words at most. */
  narration: z
    .string()
    .refine((n) => wordCount(n) >= 3, 'narration needs at least 3 words')
    .refine((n) => wordCount(n) <= 28, 'narration must be 28 words or fewer'),
})
export type Step = z.infer<typeof stepSchema>

export const scriptSchema = z.object({
  version: z.literal(1).default(1),
  story: z.object({name: z.string().min(1), title: z.string().min(1)}),
  /** How the script was made. Shown in `status` and kept for honesty in the deck. */
  source: z.enum(['ai', 'fallback', 'manual']),
  /** Title card text. */
  feature: z.string().min(1).max(80),
  /** 2-3 plain bullets for the Slack message ("what to check"). */
  summary: z.array(z.string().min(1).max(140)).min(1).max(3),
  steps: z
    .array(stepSchema)
    .min(3, 'a demo needs at least 3 steps')
    .max(7, 'a demo has at most 7 steps')
    .superRefine((steps, ctx) => {
      const seen = new Set<string>()
      steps.forEach((s, i) => {
        if (seen.has(s.id))
          ctx.addIssue({code: 'custom', message: `duplicate step id "${s.id}"`, path: [i, 'id']})
        seen.add(s.id)
      })
    }),
})
export type DemoScript = z.infer<typeof scriptSchema>

/** Rough runtime at a calm 150 words per minute, plus about 3 s of title and end cards each. */
export function estimateSeconds(script: DemoScript): number {
  const words = script.steps.reduce((n, s) => n + wordCount(s.narration), 0)
  return Math.round((words / 150) * 60 + 6)
}
