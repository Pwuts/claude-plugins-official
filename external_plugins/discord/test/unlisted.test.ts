import { expect, test, beforeEach, afterEach, afterAll, jest, setSystemTime } from 'bun:test'
import { ChannelType } from 'discord.js'
import { BOT_ID, captureNotifications, cleanup, mkChannel, mkMsg, writeAccess } from './harness'
import { client, handleInbound, mcp } from '../server'

client.user = { id: BOT_ID, username: 'claude' } as any

const UNLISTED = '230000000000000003'
const OTHER_UNLISTED = '230000000000000004'

const capture = captureNotifications(mcp)

beforeEach(() => {
  capture.notes.length = 0
  writeAccess({ dmPolicy: 'allowlist', allowFrom: [], groups: {} })
})
afterEach(() => {
  jest.useRealTimers()
  setSystemTime()
})
afterAll(() => {
  capture.restore()
  cleanup()
})

// Notices are limited per sender, so each test speaks as someone the others never were.
let senders = 0
function sender(): string {
  return `53000000000000${String(senders++).padStart(4, '0')}`
}

function unlisted(o: Record<string, unknown> = {}): any {
  const botPost = mkMsg({ id: '222', authorId: BOT_ID, bot: true })
  const channel = mkChannel({ id: UNLISTED, name: 'dev-bot-testing', messages: { '222': botPost } })
  return mkMsg({ channel, authorId: sender(), ...o })
}

test.each([
  ['an @mention', { mentionsBot: true }],
  ['a reply to the bot', { reference: { messageId: '222' } }],
])('%s in an unlisted channel DMs the sender and delivers nothing', async (_, o) => {
  const msg = unlisted(o)
  await handleInbound(msg)
  expect(capture.notes).toEqual([])
  expect(msg.replies).toEqual([])
  expect(msg.author.dms.length).toBe(1)
  expect(msg.author.dms[0]).toContain(`<#${UNLISTED}>`)
  expect(msg.author.dms[0]).toContain(`/discord:access group add ${UNLISTED}`)
})

test.each([
  ['a plain message', {}],
  ['an @everyone', { everyone: true }],
  ["another bot's mention", { bot: true, mentionsBot: true }],
])('%s in an unlisted channel sends nothing', async (_, o) => {
  const msg = unlisted(o)
  await handleInbound(msg)
  expect(capture.notes).toEqual([])
  expect(msg.author.dms).toEqual([])
  expect(msg.replies).toEqual([])
})

test('a mention in a thread under an unlisted channel names the parent, the id the allowlist takes', async () => {
  const thread = mkChannel({ id: '300000000000000002', type: ChannelType.PublicThread, parentId: UNLISTED })
  const msg = mkMsg({ channel: thread, authorId: sender(), mentionsBot: true })
  await handleInbound(msg)
  expect(msg.author.dms[0]).toContain(`/discord:access group add ${UNLISTED}`)
  expect(msg.author.dms[0]).not.toContain('300000000000000002')
})

test('a sender hears it once per channel per hour', async () => {
  const start = new Date('2026-09-29T12:00:00Z').getTime()
  setSystemTime(start)
  const [asker, other] = [sender(), sender()]
  const notices = async (authorId: string, channelId: string) => {
    const msg = mkMsg({ channel: mkChannel({ id: channelId }), authorId, mentionsBot: true })
    await handleInbound(msg)
    return msg.author.dms.length + msg.replies.length
  }

  expect(await notices(asker, UNLISTED)).toBe(1)
  expect(await notices(asker, UNLISTED)).toBe(0)
  expect(await notices(asker, OTHER_UNLISTED)).toBe(1)
  expect(await notices(other, UNLISTED)).toBe(1)

  setSystemTime(start + 59 * 60 * 1000)
  expect(await notices(asker, UNLISTED)).toBe(0)
  setSystemTime(start + 60 * 60 * 1000)
  expect(await notices(asker, UNLISTED)).toBe(1)
})

test('closed DMs fall back to a reply in the channel that deletes itself after 30 s', async () => {
  jest.useFakeTimers()
  const msg = unlisted({ mentionsBot: true, dmsClosed: true })
  await handleInbound(msg)
  expect(msg.author.dms).toEqual([])
  expect(msg.replies.length).toBe(1)
  const [notice] = msg.replies
  expect(notice.payload.content).toContain(`/discord:access group add ${UNLISTED}`)

  jest.advanceTimersByTime(29_000)
  expect(notice.deleted).toBe(false)
  jest.advanceTimersByTime(1_000)
  expect(notice.deleted).toBe(true)
})
