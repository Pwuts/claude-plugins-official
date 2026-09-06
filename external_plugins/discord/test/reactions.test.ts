import { expect, test, beforeEach, afterAll } from 'bun:test'
import { ChannelType, GatewayIntentBits } from 'discord.js'
import { BOT_ID, captureNotifications, cleanup, mkChannel, mkMsg, writeAccess } from './harness'
import { callTool, client, handleReaction, mcp } from '../server'

client.user = { id: BOT_ID, username: 'claude' } as any

const CHANNEL = '200000000000000001'
const REINIER = '244903587505897472'
const TORAN = '246045816865816577'

function serveChannels(...chans: any[]): void {
  const byId = new Map(chans.map(c => [c.id, c]))
  client.channels.fetch = (async (id: string) => byId.get(id) ?? null) as any
}

function mkReaction(o: { messageId?: string; authorId?: string; emoji?: { name: string; id?: string }; channelId?: string } = {}): any {
  return {
    emoji: o.emoji ?? { name: '👍', id: null },
    message: {
      id: o.messageId ?? '888',
      channelId: o.channelId ?? CHANNEL,
      author: o.authorId ? { id: o.authorId, username: 'someone' } : null,
      fetch: async () => ({ author: { id: o.authorId ?? REINIER } }),
    },
  }
}

const REINIER_USER = { id: REINIER, username: 'Pwuts', bot: false }

function withReactions(extra: Record<string, unknown> = {}): void {
  writeAccess({
    dmPolicy: 'allowlist',
    allowFrom: [REINIER],
    groups: { [CHANNEL]: { requireMention: false, allowFrom: [], reactions: true, ...extra } },
  })
}

beforeEach(() => {
  serveChannels(mkChannel({ id: CHANNEL, name: 'eng-general' }))
  withReactions()
})
afterAll(cleanup)

test('the client subscribes to guild reaction events', () => {
  expect(client.options.intents.has(GatewayIntentBits.GuildMessageReactions)).toBe(true)
})

test('a reaction in an opted-in channel is delivered with its emoji and target', async () => {
  const cap = captureNotifications(mcp)
  await handleReaction(mkReaction({ authorId: TORAN }), REINIER_USER as any)
  const meta = cap.notes.at(-1).params.meta
  expect(meta.event).toBe('reaction')
  expect(meta.reaction).toBe('👍')
  expect(meta.message_id).toBe('888')
  expect(meta.user_id).toBe(REINIER)
  expect(meta.chat_id).toBe(CHANNEL)
  expect(meta.channel_name).toBe('eng-general')
  expect(meta.on_own_message).toBe('false')
  cap.restore()
})

test('a channel without reactions: true delivers nothing', async () => {
  writeAccess({ dmPolicy: 'allowlist', allowFrom: [REINIER], groups: { [CHANNEL]: { requireMention: false, allowFrom: [] } } })
  const cap = captureNotifications(mcp)
  await handleReaction(mkReaction(), REINIER_USER as any)
  expect(cap.notes).toEqual([])
  cap.restore()
})

test('requireMention narrows reactions to messages the bot sent', async () => {
  withReactions({ requireMention: true })
  const cap = captureNotifications(mcp)
  await handleReaction(mkReaction({ authorId: TORAN }), REINIER_USER as any)
  expect(cap.notes).toEqual([])

  await handleReaction(mkReaction({ messageId: '889', authorId: BOT_ID }), REINIER_USER as any)
  expect(cap.notes.length).toBe(1)
  expect(cap.notes[0].params.meta.on_own_message).toBe('true')
  cap.restore()
})

test('a reaction on a message this process just sent counts as its own', async () => {
  withReactions({ requireMention: true })
  const ch = mkChannel({ id: CHANNEL })
  serveChannels(ch)
  const sent = await callTool('reply', { chat_id: CHANNEL, text: 'done' })
  const id = /id: (\d+)/.exec(sent.content[0].text)![1]

  const cap = captureNotifications(mcp)
  // author is null and fetch() reports someone else — only recentSentIds knows.
  await handleReaction({ emoji: { name: '👍', id: null }, message: { id, channelId: CHANNEL, author: null, fetch: async () => ({ author: { id: TORAN } }) } } as any, REINIER_USER as any)
  expect(cap.notes.length).toBe(1)
  cap.restore()
})

test('the bot ignores its own reactions', async () => {
  // allowBots is on, so the own-id check is the only thing that can stop this.
  withReactions({ allowBots: true })
  const cap = captureNotifications(mcp)
  await handleReaction(mkReaction(), { id: BOT_ID, username: 'claude', bot: true } as any)
  expect(cap.notes).toEqual([])
  cap.restore()
})

test('a bot reaction needs allowBots', async () => {
  const sentry = { id: '700000000000000001', username: 'Sentry', bot: true }
  const cap = captureNotifications(mcp)
  await handleReaction(mkReaction(), sentry as any)
  expect(cap.notes).toEqual([])

  withReactions({ allowBots: true })
  await handleReaction(mkReaction(), sentry as any)
  expect(cap.notes.length).toBe(1)
  cap.restore()
})

test('the channel allowFrom list applies to reactions', async () => {
  withReactions({ allowFrom: [TORAN] })
  const cap = captureNotifications(mcp)
  await handleReaction(mkReaction(), REINIER_USER as any)
  expect(cap.notes).toEqual([])

  await handleReaction(mkReaction(), { id: TORAN, username: 'torantula', bot: false } as any)
  expect(cap.notes.length).toBe(1)
  cap.restore()
})

test('a custom emoji is reported in the <:name:id> form', async () => {
  const cap = captureNotifications(mcp)
  await handleReaction(mkReaction({ emoji: { name: 'shipit', id: '5551234' } }), REINIER_USER as any)
  expect(cap.notes.at(-1).params.meta.reaction).toBe('<:shipit:5551234>')
  cap.restore()
})

test('a reaction in a thread reports the thread and its parent', async () => {
  const thread = mkChannel({ id: '300000000000000001', type: ChannelType.PublicThread, name: 'review', parentId: CHANNEL })
  serveChannels(thread)
  const cap = captureNotifications(mcp)
  await handleReaction(mkReaction({ channelId: '300000000000000001' }), REINIER_USER as any)
  const meta = cap.notes.at(-1).params.meta
  expect(meta.thread).toBe('true')
  expect(meta.parent_id).toBe(CHANNEL)
  cap.restore()
})

test('a DM reaction is not delivered', async () => {
  serveChannels(mkChannel({ id: '600000000000000001', type: ChannelType.DM }))
  const cap = captureNotifications(mcp)
  await handleReaction(mkReaction({ channelId: '600000000000000001' }), REINIER_USER as any)
  expect(cap.notes).toEqual([])
  cap.restore()
})
