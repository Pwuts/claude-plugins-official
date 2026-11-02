import { expect, test, beforeEach, afterAll } from 'bun:test'
import { BOT_ID, captureNotifications, cleanup, mkChannel, mkMsg, writeAccess } from './harness'
import { client, gate, handleReaction, mcp } from '../server'

client.user = { id: BOT_ID, username: 'claude' } as any

const CHANNEL = '200000000000000001'
const UNLISTED = '230000000000000003'
const DISPATCH = '700000000000000002'
const SENTRY = '700000000000000001'
const OWNER = '510000000000000001'

beforeEach(() => {
  writeAccess({
    dmPolicy: 'allowlist',
    allowFrom: [OWNER],
    trustedBots: [DISPATCH],
    groups: {
      [CHANNEL]: { requireMention: false, allowFrom: [] },
    },
  })
})
afterAll(cleanup)

test('a trusted bot delivers in a listed channel with no allowBots', async () => {
  const msg = mkMsg({ authorId: DISPATCH, username: 'Dispatch', bot: true })
  expect((await gate(msg)).action).toBe('deliver')
})

test('a trusted bot still drops in an unlisted channel', async () => {
  const msg = mkMsg({ channel: mkChannel({ id: UNLISTED }), authorId: DISPATCH, bot: true })
  expect((await gate(msg)).action).toBe('drop')
})

test('an untrusted bot still drops', async () => {
  const msg = mkMsg({ authorId: SENTRY, username: 'Sentry', bot: true })
  expect((await gate(msg)).action).toBe('drop')
})

test('requireMention still applies to a trusted bot', async () => {
  writeAccess({
    dmPolicy: 'allowlist',
    allowFrom: [OWNER],
    trustedBots: [DISPATCH],
    groups: { [CHANNEL]: { requireMention: true, allowFrom: [] } },
  })
  const msg = mkMsg({ authorId: DISPATCH, bot: true })
  expect((await gate(msg)).action).toBe('drop')
  const mentioned = mkMsg({ authorId: DISPATCH, bot: true, mentionsBot: true })
  expect((await gate(mentioned)).action).toBe('deliver')
})

test('the channel allowFrom list still applies to a trusted bot', async () => {
  writeAccess({
    dmPolicy: 'allowlist',
    allowFrom: [OWNER],
    trustedBots: [DISPATCH],
    groups: { [CHANNEL]: { requireMention: false, allowFrom: [OWNER] } },
  })
  const msg = mkMsg({ authorId: DISPATCH, bot: true })
  expect((await gate(msg)).action).toBe('drop')
})

test('a trusted bot reaction is delivered with no allowBots', async () => {
  const ch = mkChannel({ id: CHANNEL })
  client.channels.fetch = (async (id: string) => (id === CHANNEL ? ch : null)) as any
  writeAccess({
    dmPolicy: 'allowlist',
    allowFrom: [OWNER],
    trustedBots: [DISPATCH],
    groups: { [CHANNEL]: { requireMention: false, allowFrom: [], reactions: true } },
  })
  const cap = captureNotifications(mcp)
  await handleReaction(
    { emoji: { name: '👍' }, message: { id: '1', channelId: CHANNEL, author: null, fetch: async () => ({ author: { id: OWNER } }) } } as any,
    { id: DISPATCH, username: 'Dispatch', bot: true } as any,
  )
  expect(cap.notes.length).toBe(1)
  cap.restore()
})

test('an untrusted bot reaction still needs allowBots', async () => {
  const ch = mkChannel({ id: CHANNEL })
  client.channels.fetch = (async (id: string) => (id === CHANNEL ? ch : null)) as any
  const cap = captureNotifications(mcp)
  await handleReaction(
    { emoji: { name: '👍' }, message: { id: '1', channelId: CHANNEL, author: null, fetch: async () => ({ author: { id: OWNER } }) } } as any,
    { id: SENTRY, username: 'Sentry', bot: true } as any,
  )
  expect(cap.notes).toEqual([])
  cap.restore()
})
