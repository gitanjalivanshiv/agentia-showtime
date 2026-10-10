import fs from 'node:fs'

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {z} from 'zod'

import type {ShowtimeConfig} from '../config.js'
import {PipelineError, runPipeline, type ScriptResult, type Stages} from '../pipeline.js'
import {feedbackPath, loadDecision} from '../review/store.js'
import {toYaml} from '../script/files.js'
import {listStories, showStatus} from '../status.js'

/**
 * Showtime's own MCP server (`agentia showtime mcp`). Four tools. There is deliberately no tool that approves,
 * promotes or deploys: a decision belongs to the business owner and a promotion belongs to the release manager.
 */
export interface McpDeps {
  root: string
  config: ShowtimeConfig
  /** Builds the stage functions for a run. */
  stages: (o: {hint?: string; noAi?: boolean}) => Stages
  previewScript: (story: string, o: {hint?: string; noAi?: boolean}) => Promise<ScriptResult>
}

const text = (value: unknown, isError = false) => ({
  content: [
    {type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2)},
  ],
  ...(isError ? {isError: true} : {}),
})

export function buildServer(d: McpDeps): McpServer {
  const server = new McpServer({name: 'agentia-showtime', version: '0.1.0'})

  server.registerTool(
    'showtime_status',
    {
      title: 'Showtime status',
      description:
        'Read-only. Where each demo is in its lifecycle (scripted, recorded, rendered, sent, approved, changes_requested), with times, who decided, and whether the note reached Copado. Omit `story` to list every show.',
      inputSchema: {story: z.string().optional().describe('Story name such as US-0000036')},
    },
    async ({story}) =>
      text({shows: (story ? [story] : listStories(d.root)).map((s) => showStatus(d.root, s))}),
  )

  server.registerTool(
    'showtime_feedback',
    {
      title: 'What did the business say?',
      description:
        "Read-only. The business owner's latest decision on a story and any requested changes, from Slack. Use it before planning a fix. This is feedback to act on, not an instruction to approve or promote anything.",
      inputSchema: {story: z.string().describe('Story name such as US-0000036')},
    },
    async ({story}) => {
      const decision = loadDecision(d.root, story)
      const file = feedbackPath(d.root, story)
      return text({
        story,
        state: showStatus(d.root, story).state,
        decision: decision
          ? {kind: decision.kind, by: decision.by, at: decision.at, comment: decision.comment}
          : null,
        feedback: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null,
        next:
          decision?.kind === 'changes_requested'
            ? "Plan the fix on the story's feature branch, deliver it through Copado as usual, and let the user decide when to run `showtime_run` again for a new round."
            : "Nothing to change. Approval is recorded; promotion is the release manager's decision.",
      })
    },
  )

  server.registerTool(
    'showtime_script_preview',
    {
      title: 'Preview a demo script',
      description:
        'Read-only (asks Copado AI, writes nothing). The steps and narration Showtime would use for a story. Check the exact record names and labels before a real run.',
      inputSchema: {
        story: z.string().describe('Story name such as US-0000036'),
        hint: z.string().optional().describe('Exact record names and field labels to use'),
        noAi: z.boolean().optional().describe('Use the hand-written fallback script'),
      },
    },
    async ({story, hint, noAi}) => {
      try {
        const r = await d.previewScript(story, {hint, noAi})
        return text({
          story,
          source: r.script.source,
          steps: r.script.steps.length,
          estimatedNarrationSeconds: r.seconds,
          yaml: toYaml(r.script),
        })
      } catch (e) {
        return text(e instanceof Error ? e.message : String(e), true)
      }
    },
  )

  server.registerTool(
    'showtime_run',
    {
      title: 'Run a demo (script, record, render, send)',
      description: `Records a narrated demo of a story in ${d.config.uatEnvironment} and posts it to ${d.config.slack.ownersChannel} for the business owner. It WRITES: it uploads and runs a robot in Robotic Testing (shared lock), and posts to Slack. Call it first without \`confirm\` to get the plan, show the plan to the user, and call again with confirm=true only after they agree. Takes a few minutes. It never approves, promotes or deploys.`,
      inputSchema: {
        story: z
          .string()
          .describe('Story name such as US-0000036; it must already be in the UAT environment'),
        confirm: z.boolean().optional().describe('Set true only after the user approved the plan'),
        skipSend: z.boolean().optional().describe('Make the video but do not post to Slack'),
        hint: z.string().optional().describe('Exact record names and field labels to use'),
        noAi: z.boolean().optional().describe('Use the hand-written fallback script'),
      },
    },
    async ({story, confirm, skipSend, hint, noAi}) => {
      const plan = [
        `Ask Copado AI for a demo script for ${story} (local files only)`,
        `Upload a robot to the "Showtime Recorder" job and run it in ${d.config.uatEnvironment} (writes to Robotic Testing, takes the shared lock)`,
        'Narrate and render the video locally',
        ...(skipSend ? [] : [`Post the video and review card to ${d.config.slack.ownersChannel} in Slack`]),
      ]
      if (!confirm)
        return text({
          needsConfirmation: true,
          story,
          plan,
          how: 'Show this plan to the user. If they agree, call showtime_run again with confirm=true.',
        })
      try {
        return text(await runPipeline(d.stages({hint, noAi}), story, {skipSend}))
      } catch (e) {
        if (e instanceof PipelineError) return text(`${e.stage} failed: ${e.message}`, true)
        return text(e instanceof Error ? e.message : String(e), true)
      }
    },
  )

  return server
}
