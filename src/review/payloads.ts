/** Slack Block Kit payload builders. Pure functions: the same input always gives the same JSON. */

export type Block = Record<string, unknown>

export const ACTIONS = {
  approve: 'showtime_approve',
  changes: 'showtime_changes',
  openUat: 'showtime_open_uat',
} as const
export const MODAL_ID = 'showtime_changes_modal'

export interface ReviewInfo {
  story: string
  feature: string
  summary: string[]
  seconds: number
  uatUrl?: string
}

const bullets = (items: string[]) => items.map((i) => `• ${i}`).join('\n')
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Slack renders `<!date>` in the reader's own time zone; the fallback text covers old clients. */
export const slackTime = (d: Date) => {
  const unix = Math.floor(d.getTime() / 1000)
  return `<!date^${unix}^{time}|${d.toISOString().slice(11, 16)} UTC>`
}

export function reviewBlocks(i: ReviewInfo): Block[] {
  const buttons: Block[] = [
    {
      type: 'button',
      action_id: ACTIONS.approve,
      style: 'primary',
      text: {type: 'plain_text', text: '✅ Approve', emoji: true},
      value: i.story,
    },
    {
      type: 'button',
      action_id: ACTIONS.changes,
      text: {type: 'plain_text', text: '✏️ Request changes', emoji: true},
      value: i.story,
    },
  ]
  if (i.uatUrl) {
    buttons.push({
      type: 'button',
      action_id: ACTIONS.openUat,
      text: {type: 'plain_text', text: '🔗 Open in UAT', emoji: true},
      url: i.uatUrl,
    })
  }
  return [
    {type: 'header', text: {type: 'plain_text', text: '🎬 Your feature is ready to review', emoji: true}},
    {type: 'section', text: {type: 'mrkdwn', text: `*${clip(i.feature, 120)}*\n${i.story}`}},
    {type: 'section', text: {type: 'mrkdwn', text: `*What to check*\n${bullets(i.summary)}`}},
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `▶️ Watch the ${Math.round(i.seconds)}-second demo above, then choose. Nothing is released until your release manager promotes it.`,
        },
      ],
    },
    {type: 'actions', block_id: `showtime_review_${i.story}`, elements: buttons},
  ]
}

export const reviewFallback = (i: ReviewInfo) => `Your feature is ready to review: ${i.feature} (${i.story})`

export type DecisionKind = 'approved' | 'changes_requested'
export interface DecidedInfo extends ReviewInfo {
  kind: DecisionKind
  by: string
  at: Date
  comment?: string
}

/** The review card after a decision: same content, buttons replaced by the outcome. */
export function decidedBlocks(i: DecidedInfo): Block[] {
  const outcome =
    i.kind === 'approved'
      ? `✅ *Approved* by ${i.by} at ${slackTime(i.at)}`
      : `✏️ *Changes requested* by ${i.by} at ${slackTime(i.at)}${i.comment ? `\n> ${clip(i.comment.replace(/\n/g, '\n> '), 600)}` : ''}`
  return [
    ...reviewBlocks(i).filter((b) => b.type !== 'actions'),
    {type: 'divider'},
    {type: 'section', text: {type: 'mrkdwn', text: outcome}},
  ]
}

export const decidedFallback = (i: DecidedInfo) =>
  i.kind === 'approved' ? `Approved by ${i.by}: ${i.feature}` : `Changes requested by ${i.by}: ${i.feature}`

export interface ReleaseInfo {
  story: string
  feature: string
  by: string
  at: Date
  videoUrl?: string
}

export function releaseBlocks(i: ReleaseInfo): Block[] {
  return [
    {type: 'header', text: {type: 'plain_text', text: '✅ Approved for release', emoji: true}},
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${clip(i.feature, 120)}*\n${i.story}${i.videoUrl ? `\n<${i.videoUrl}|▶️ Watch the demo>` : ''}`,
      },
    },
    {type: 'context', elements: [{type: 'mrkdwn', text: `Approved by ${i.by} at ${slackTime(i.at)}`}]},
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '👉 *Promotion is yours to run.* Showtime records decisions; it never promotes or deploys.',
      },
    },
  ]
}

export const releaseFallback = (i: ReleaseInfo) =>
  `Approved for release: ${i.feature} (${i.story}), approved by ${i.by}`

export function feedbackModal(story: string, feature: string): Record<string, unknown> {
  return {
    type: 'modal',
    callback_id: MODAL_ID,
    private_metadata: story,
    title: {type: 'plain_text', text: 'Request changes'},
    submit: {type: 'plain_text', text: 'Send to the team'},
    close: {type: 'plain_text', text: 'Cancel'},
    blocks: [
      {type: 'section', text: {type: 'mrkdwn', text: `*${clip(feature, 120)}*\n${story}`}},
      {
        type: 'input',
        block_id: 'comment_block',
        label: {type: 'plain_text', text: 'What should change?'},
        element: {
          type: 'plain_text_input',
          action_id: 'comment',
          multiline: true,
          max_length: 1500,
          placeholder: {type: 'plain_text', text: 'For example: also escalate cases for Platinum accounts.'},
        },
      },
    ],
  }
}
