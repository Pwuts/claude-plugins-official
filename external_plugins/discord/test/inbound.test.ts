import { expect, test, beforeEach, afterAll } from 'bun:test'
import { ChannelType, MessageType } from 'discord.js'
import { BOT_ID, captureNotifications, cleanup, mkChannel, mkEmbed, mkMsg, writeAccess } from './harness'
import { client, defaultAccess, embedText, handleInbound, inboundMeta, mcp } from '../server'

client.user = { id: BOT_ID, username: 'claude' } as any

const CHANNEL = '200000000000000001'
const TEAMMATE = '520000000000000002'
const OWNER = '510000000000000001'

beforeEach(() => {
  writeAccess({ dmPolicy: 'allowlist', allowFrom: [OWNER], groups: { [CHANNEL]: { requireMention: false, allowFrom: [] } } })
})
afterAll(cleanup)

test('a plain channel message carries the channel name and no reply/mention signals', async () => {
  const meta = await inboundMeta(mkMsg({ authorId: TEAMMATE, username: 'teammate' }), [], defaultAccess())
  expect(meta.channel_name).toBe('general')
  expect(meta.mentions_bot).toBe('false')
  expect(meta.reply_to).toBeUndefined()
  expect(meta.reply_to_user_id).toBeUndefined()
  expect(meta.mentions).toBeUndefined()
  expect(meta.thread).toBeUndefined()
})

test('a reply to another human reports that human, not the bot', async () => {
  const target = mkMsg({ id: '111', authorId: TEAMMATE })
  const channel = mkChannel({ messages: { '111': target } })
  const msg = mkMsg({
    authorId: OWNER,
    channel,
    reference: { messageId: '111' },
    mentions: [TEAMMATE],
    content: 'can you look at this?',
  })
  const meta = await inboundMeta(msg, [], defaultAccess())
  expect(meta.reply_to).toBe('111')
  expect(meta.reply_to_user_id).toBe(TEAMMATE)
  expect(meta.mentions).toBe(TEAMMATE)
  expect(meta.mentions_bot).toBe('false')
})

test('a reply to the bot is addressed to the bot even without an @mention', async () => {
  const mine = mkMsg({ id: '222', authorId: BOT_ID, username: 'claude', bot: true })
  const channel = mkChannel({ messages: { '222': mine } })
  const msg = mkMsg({ authorId: OWNER, channel, reference: { messageId: '222' } })
  const meta = await inboundMeta(msg, [], defaultAccess())
  expect(meta.reply_to_user_id).toBe(BOT_ID)
  expect(meta.mentions_bot).toBe('true')
})

test('an @mention of the bot sets mentions_bot and lists every mentioned id', async () => {
  const msg = mkMsg({ authorId: TEAMMATE, mentionsBot: true, mentions: [OWNER] })
  const meta = await inboundMeta(msg, [], defaultAccess())
  expect(meta.mentions_bot).toBe('true')
  expect(meta.mentions!.split(',').sort()).toEqual([OWNER, BOT_ID].sort())
})

test('a thread message reports thread and parent_id', async () => {
  const channel = mkChannel({
    id: '300000000000000001',
    type: ChannelType.PublicThread,
    name: 'review thread',
    parentId: CHANNEL,
  })
  const meta = await inboundMeta(mkMsg({ channel }), [], defaultAccess())
  expect(meta.thread).toBe('true')
  expect(meta.parent_id).toBe(CHANNEL)
  expect(meta.chat_id).toBe('300000000000000001')
})

test('a DM is always addressed to the bot', async () => {
  const channel = mkChannel({ id: '600000000000000001', type: ChannelType.DM, name: undefined })
  delete (channel as any).name
  const meta = await inboundMeta(mkMsg({ channel, authorId: OWNER }), [], defaultAccess())
  expect(meta.mentions_bot).toBe('true')
  expect(meta.channel_name).toBeUndefined()
})

test('a mention pattern counts as a mention', async () => {
  const access = { ...defaultAccess(), mentionPatterns: ['^hey claude\\b'] }
  const msg = mkMsg({ authorId: TEAMMATE, content: 'hey claude can you check CI' })
  expect((await inboundMeta(msg, [], access)).mentions_bot).toBe('true')
})

test('a deleted parent message leaves reply_to without reply_to_user_id', async () => {
  const channel = mkChannel({ messages: {} })
  const msg = mkMsg({ channel, reference: { messageId: '999' } })
  const meta = await inboundMeta(msg, [], defaultAccess())
  expect(meta.reply_to).toBe('999')
  expect(meta.reply_to_user_id).toBeUndefined()
})

test('attachments still land in meta', async () => {
  const meta = await inboundMeta(mkMsg(), ['log.txt (text/plain, 4KB)'], defaultAccess())
  expect(meta.attachment_count).toBe('1')
  expect(meta.attachments).toBe('log.txt (text/plain, 4KB)')
})

test('a thread rename is delivered as a system event that keeps the new name', async () => {
  const capture = captureNotifications(mcp)
  try {
    const thread = mkChannel({ id: '300000000000000002', type: ChannelType.PublicThread, parentId: CHANNEL })
    await handleInbound(
      mkMsg({ channel: thread, authorId: OWNER, type: MessageType.ChannelNameChange, content: 'release plan: rollout' }),
    )
    expect(capture.notes.length).toBe(1)
    expect(capture.notes[0].params.content).toBe('release plan: rollout')
    expect(capture.notes[0].params.meta.system).toBe('channel_name_change')
  } finally {
    capture.restore()
  }
})

test('a pin of the bot\'s own message reads as addressed, and system says it is a pin notice', async () => {
  const mine = mkMsg({ id: '333', authorId: BOT_ID, username: 'claude', bot: true })
  const channel = mkChannel({ messages: { '333': mine } })
  const pin = mkMsg({ channel, authorId: OWNER, type: MessageType.ChannelPinnedMessage, content: '', reference: { messageId: '333' } })
  const meta = await inboundMeta(pin, [], defaultAccess())
  expect(meta.mentions_bot).toBe('true')
  expect(meta.system).toBe('channel_pinned_message')
})

test.each([
  ['a plain message', MessageType.Default],
  ['a reply', MessageType.Reply],
  ['a slash-command response', MessageType.ChatInputCommand],
])('%s carries no system attribute', async (_, type) => {
  const meta = await inboundMeta(mkMsg({ authorId: TEAMMATE, type }), [], defaultAccess())
  expect(meta.system).toBeUndefined()
})

test('embedText renders title+url, description, fields and footer', () => {
  const embed = mkEmbed({
    title: 'Alert: high error rate',
    url: 'https://sentry.io/issues/123',
    description: 'Something broke.',
    fields: [{ name: 'Project', value: 'platform-backend' }],
    footer: { text: 'Sentry' },
  })
  expect(embedText([embed])).toBe(
    'Alert: high error rate (https://sentry.io/issues/123)\nSomething broke.\nProject: platform-backend\nSentry',
  )
})

test('embedText skips parts the embed does not have', () => {
  expect(embedText([mkEmbed({ title: 'just a title' })])).toBe('just a title')
})

test('embedText joins several embeds with a blank line', () => {
  const text = embedText([mkEmbed({ title: 'first' }), mkEmbed({ title: 'second' })])
  expect(text).toBe('first\n\nsecond')
})

test('embedText is empty for no embeds', () => {
  expect(embedText([])).toBe('')
  expect(embedText(undefined)).toBe('')
})

test('embedText caps long embed text with an ellipsis', () => {
  const text = embedText([mkEmbed({ description: 'x'.repeat(5000) })])
  expect(text.length).toBe(4001)
  expect(text.endsWith('…')).toBe(true)
})

test('a Sentry-style alert with an empty-content embed arrives with the embed text as content', async () => {
  const capture = captureNotifications(mcp)
  try {
    const msg = mkMsg({
      authorId: TEAMMATE,
      content: '',
      embeds: [
        mkEmbed({
          title: 'high error rate',
          url: 'https://sentry.io/issues/123',
          fields: [{ name: 'Project', value: 'platform-backend' }],
        }),
      ],
    })
    await handleInbound(msg)
    expect(capture.notes.length).toBe(1)
    expect(capture.notes[0].params.content).toBe(
      'high error rate (https://sentry.io/issues/123)\nProject: platform-backend',
    )
  } finally {
    capture.restore()
  }
})

test('an embed on a message that also has text is appended after it', async () => {
  const capture = captureNotifications(mcp)
  try {
    await handleInbound(mkMsg({ authorId: TEAMMATE, content: 'look at this', embeds: [mkEmbed({ title: 'linked page' })] }))
    expect(capture.notes[0].params.content).toBe('look at this\n\nlinked page')
  } finally {
    capture.restore()
  }
})

test('a message with no embeds is unchanged', async () => {
  const capture = captureNotifications(mcp)
  try {
    await handleInbound(mkMsg({ authorId: TEAMMATE, content: 'plain text' }))
    expect(capture.notes[0].params.content).toBe('plain text')
  } finally {
    capture.restore()
  }
})
