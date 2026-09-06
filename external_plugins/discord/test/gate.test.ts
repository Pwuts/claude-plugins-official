import { expect, test, beforeEach, afterAll } from 'bun:test'
import { ChannelType } from 'discord.js'
import { BOT_ID, captureNotifications, cleanup, mkChannel, mkMsg, writeAccess } from './harness'
import { client, gate, handleInbound, mcp } from '../server'

client.user = { id: BOT_ID, username: 'claude' } as any

const CHANNEL = '200000000000000001'
const ALERTS = '210000000000000002'
const SENTRY = '700000000000000001'
const REINIER = '244903587505897472'

const tick = () => new Promise(r => setTimeout(r, 5))

beforeEach(() => {
  writeAccess({
    dmPolicy: 'allowlist',
    allowFrom: [REINIER],
    groups: {
      [CHANNEL]: { requireMention: false, allowFrom: [] },
      [ALERTS]: { requireMention: false, allowFrom: [], allowBots: true },
    },
  })
})
afterAll(cleanup)

test('a bot post in an ordinary opted-in channel is dropped', async () => {
  const msg = mkMsg({ authorId: SENTRY, username: 'Sentry', bot: true })
  expect((await gate(msg)).action).toBe('drop')
})

test('a bot post in an allowBots channel is delivered', async () => {
  const msg = mkMsg({ channel: mkChannel({ id: ALERTS, name: 'on-call-alerts' }), authorId: SENTRY, bot: true })
  expect((await gate(msg)).action).toBe('deliver')
})

test('allowBots still honours the channel allowFrom list', async () => {
  writeAccess({
    dmPolicy: 'allowlist',
    allowFrom: [REINIER],
    groups: { [ALERTS]: { requireMention: false, allowFrom: [SENTRY], allowBots: true } },
  })
  const other = mkMsg({ channel: mkChannel({ id: ALERTS }), authorId: '700000000000000009', bot: true })
  expect((await gate(other)).action).toBe('drop')
  const sentry = mkMsg({ channel: mkChannel({ id: ALERTS }), authorId: SENTRY, bot: true })
  expect((await gate(sentry)).action).toBe('deliver')
})

test('allowBots does not bypass requireMention', async () => {
  writeAccess({
    dmPolicy: 'allowlist',
    allowFrom: [REINIER],
    groups: { [ALERTS]: { requireMention: true, allowFrom: [], allowBots: true } },
  })
  const msg = mkMsg({ channel: mkChannel({ id: ALERTS }), authorId: SENTRY, bot: true })
  expect((await gate(msg)).action).toBe('drop')
})

test('a bot DM is dropped even if its id is allowlisted', async () => {
  writeAccess({ dmPolicy: 'allowlist', allowFrom: [REINIER, SENTRY], groups: {} })
  const dm = mkChannel({ id: '600000000000000001', type: ChannelType.DM })
  expect((await gate(mkMsg({ channel: dm, authorId: SENTRY, bot: true }))).action).toBe('drop')
  expect((await gate(mkMsg({ channel: dm, authorId: REINIER }))).action).toBe('deliver')
})

test('a bot post is delivered without a typing indicator or ack reaction', async () => {
  writeAccess({
    dmPolicy: 'allowlist',
    allowFrom: [REINIER],
    groups: {
      [CHANNEL]: { requireMention: false, allowFrom: [] },
      [ALERTS]: { requireMention: false, allowFrom: [], allowBots: true },
    },
    ackReaction: '👀',
  })
  const cap = captureNotifications(mcp)
  const alert = mkMsg({ channel: mkChannel({ id: ALERTS }), authorId: SENTRY, username: 'Sentry', bot: true })
  await handleInbound(alert)
  expect(alert.reactions).toEqual([])
  expect(cap.notes.at(-1).params.meta.author_is_bot).toBe('true')

  const human = mkMsg({ authorId: REINIER, username: 'Pwuts' })
  await handleInbound(human)
  expect(human.reactions).toEqual(['👀'])
  expect(cap.notes.at(-1).params.meta.author_is_bot).toBeUndefined()
  cap.restore()
})

test('the bot never processes its own messages', async () => {
  const cap = captureNotifications(mcp)
  // In the allowBots channel the gate would let a bot through, so this is the
  // own-id check and nothing else.
  const own = mkMsg({ channel: mkChannel({ id: ALERTS }), authorId: BOT_ID, username: 'claude', bot: true })
  client.emit('messageCreate', own as any)
  await tick()
  expect(cap.notes).toEqual([])

  client.emit('messageCreate', mkMsg({ authorId: REINIER, username: 'Pwuts' }) as any)
  await tick()
  expect(cap.notes.length).toBe(1)
  cap.restore()
})

test('a permission reply is only acted on from the DM allowlist', async () => {
  const cap = captureNotifications(mcp)
  await handleInbound(mkMsg({ authorId: '800000000000000001', username: 'stranger', content: 'y abcde' }))
  expect(cap.notes.at(-1).method).toBe('notifications/claude/channel')

  await handleInbound(mkMsg({ authorId: REINIER, username: 'Pwuts', content: 'y abcde' }))
  expect(cap.notes.at(-1).method).toBe('notifications/claude/channel/permission')
  expect(cap.notes.at(-1).params).toEqual({ request_id: 'abcde', behavior: 'allow' })
  cap.restore()
})
