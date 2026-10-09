import fs from 'node:fs'
import path from 'node:path'

import type {Block} from './payloads.js'

/** Everything Showtime needs from Slack. The real one wraps WebClient; tests use a fake. */
export interface SlackGateway {
  /** Turns `#name` or an ID into a channel ID. */
  resolveChannel(nameOrId: string): Promise<string>
  uploadVideo(o: {
    channel: string
    file: string
    title: string
    comment: string
  }): Promise<{fileId: string; permalink?: string}>
  postMessage(o: {
    channel: string
    blocks: Block[]
    text: string
    threadTs?: string
  }): Promise<{ts: string; channel: string}>
  updateMessage(o: {channel: string; ts: string; blocks: Block[]; text: string}): Promise<void>
  openModal(o: {triggerId: string; view: Record<string, unknown>}): Promise<void>
  postEphemeral(o: {channel: string; user: string; text: string}): Promise<void>
  displayName(userId: string): Promise<string>
}

/** The subset of @slack/web-api's WebClient that we call. Keeps the gateway testable. */
export interface WebClientLike {
  conversations: {
    list(
      a: Record<string, unknown>,
    ): Promise<{channels?: Array<{id?: string; name?: string}>; response_metadata?: {next_cursor?: string}}>
  }
  chat: {
    postMessage(a: Record<string, unknown>): Promise<{ts?: string; channel?: string}>
    update(a: Record<string, unknown>): Promise<unknown>
    postEphemeral(a: Record<string, unknown>): Promise<unknown>
  }
  files: {
    uploadV2(
      a: Record<string, unknown>,
    ): Promise<{files?: Array<{files?: Array<{id?: string; permalink?: string}>}>}>
    info(a: Record<string, unknown>): Promise<{file?: {permalink?: string}}>
  }
  views: {open(a: Record<string, unknown>): Promise<unknown>}
  users: {
    info(
      a: Record<string, unknown>,
    ): Promise<{user?: {real_name?: string; name?: string; profile?: {display_name?: string}}}>
  }
}

export class WebGateway implements SlackGateway {
  private readonly names = new Map<string, string>()
  constructor(private readonly client: WebClientLike) {}

  async resolveChannel(nameOrId: string): Promise<string> {
    if (/^[CGD][A-Z0-9]{8,}$/.test(nameOrId)) return nameOrId
    const want = nameOrId.replace(/^#/, '').toLowerCase()
    let cursor: string | undefined
    do {
      const r = await this.client.conversations.list({
        types: 'public_channel,private_channel',
        limit: 200,
        exclude_archived: true,
        cursor,
      })
      const hit = r.channels?.find((c) => c.name?.toLowerCase() === want)
      if (hit?.id) return hit.id
      cursor = r.response_metadata?.next_cursor || undefined
    } while (cursor)
    throw new Error(
      `Slack channel "${nameOrId}" was not found. Create it and invite the app with /invite @Showtime.`,
    )
  }

  async uploadVideo(o: {channel: string; file: string; title: string; comment: string}) {
    const r = await this.client.files.uploadV2({
      channel_id: o.channel,
      file: fs.readFileSync(o.file),
      filename: path.basename(o.file),
      title: o.title,
      initial_comment: o.comment,
    })
    const fileId = r.files?.[0]?.files?.[0]?.id
    if (!fileId) throw new Error('Slack did not return a file ID for the upload.')
    let permalink = r.files?.[0]?.files?.[0]?.permalink
    if (!permalink) permalink = (await this.client.files.info({file: fileId})).file?.permalink
    return {fileId, permalink}
  }

  async postMessage(o: {channel: string; blocks: Block[]; text: string; threadTs?: string}) {
    const r = await this.client.chat.postMessage({
      channel: o.channel,
      blocks: o.blocks,
      text: o.text,
      thread_ts: o.threadTs,
      unfurl_links: false,
    })
    if (!r.ts || !r.channel) throw new Error('Slack did not return a message timestamp.')
    return {ts: r.ts, channel: r.channel}
  }

  async updateMessage(o: {channel: string; ts: string; blocks: Block[]; text: string}) {
    await this.client.chat.update({channel: o.channel, ts: o.ts, blocks: o.blocks, text: o.text})
  }

  async openModal(o: {triggerId: string; view: Record<string, unknown>}) {
    await this.client.views.open({trigger_id: o.triggerId, view: o.view})
  }

  async postEphemeral(o: {channel: string; user: string; text: string}) {
    await this.client.chat.postEphemeral({channel: o.channel, user: o.user, text: o.text})
  }

  async displayName(userId: string): Promise<string> {
    const cached = this.names.get(userId)
    if (cached) return cached
    try {
      const u = (await this.client.users.info({user: userId})).user
      const name = u?.profile?.display_name || u?.real_name || u?.name || userId
      this.names.set(userId, name)
      return name
    } catch {
      return userId
    }
  }
}

/** Test double: records every call and hands back predictable IDs. */
export class FakeGateway implements SlackGateway {
  readonly calls: Array<{method: string; args: unknown}> = []
  private n = 0
  constructor(private readonly names: Record<string, string> = {}) {}
  private rec(method: string, args: unknown) {
    this.calls.push({method, args})
  }
  async resolveChannel(nameOrId: string) {
    this.rec('resolveChannel', nameOrId)
    return `C_${nameOrId
      .replace(/^#/, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')}`
  }
  async uploadVideo(o: {channel: string; file: string; title: string; comment: string}) {
    this.rec('uploadVideo', o)
    return {fileId: 'F001', permalink: 'https://example.slack.com/files/F001'}
  }
  async postMessage(o: {channel: string; blocks: Block[]; text: string; threadTs?: string}) {
    this.rec('postMessage', o)
    return {ts: `1700000000.00${++this.n}`, channel: o.channel}
  }
  async updateMessage(o: {channel: string; ts: string; blocks: Block[]; text: string}) {
    this.rec('updateMessage', o)
  }
  async openModal(o: {triggerId: string; view: Record<string, unknown>}) {
    this.rec('openModal', o)
  }
  async postEphemeral(o: {channel: string; user: string; text: string}) {
    this.rec('postEphemeral', o)
  }
  async displayName(userId: string) {
    return this.names[userId] ?? userId
  }
  of(method: string) {
    return this.calls.filter((c) => c.method === method).map((c) => c.args as Record<string, unknown>)
  }
}
