import { expect, test, beforeEach, afterAll } from 'bun:test'
import { ChannelType } from 'discord.js'
import { BOT_ID, cleanup, mkChannel, mkMsg, writeAccess } from './harness'
import { client, defaultAccess, inboundMeta } from '../server'

client.user = { id: BOT_ID, username: 'claude' } as any

const CHANNEL = '200000000000000001'
const TORAN = '246045816865816577'
const REINIER = '244903587505897472'

beforeEach(() => {
  writeAccess({ dmPolicy: 'allowlist', allowFrom: [REINIER], groups: { [CHANNEL]: { requireMention: false, allowFrom: [] } } })
})
afterAll(cleanup)

test('a plain channel message carries the channel name and no reply/mention signals', async () => {
  const meta = await inboundMeta(mkMsg({ authorId: TORAN, username: 'torantula' }), [], defaultAccess())
  expect(meta.channel_name).toBe('eng-general')
  expect(meta.mentions_bot).toBe('false')
  expect(meta.reply_to).toBeUndefined()
  expect(meta.reply_to_user_id).toBeUndefined()
  expect(meta.mentions).toBeUndefined()
  expect(meta.thread).toBeUndefined()
})

test('a reply to another human reports that human, not the bot', async () => {
  const target = mkMsg({ id: '111', authorId: TORAN })
  const channel = mkChannel({ messages: { '111': target } })
  const msg = mkMsg({
    authorId: REINIER,
    channel,
    reference: { messageId: '111' },
    mentions: [TORAN],
    content: 'can you look at this?',
  })
  const meta = await inboundMeta(msg, [], defaultAccess())
  expect(meta.reply_to).toBe('111')
  expect(meta.reply_to_user_id).toBe(TORAN)
  expect(meta.mentions).toBe(TORAN)
  expect(meta.mentions_bot).toBe('false')
})

test('a reply to the bot is addressed to the bot even without an @mention', async () => {
  const mine = mkMsg({ id: '222', authorId: BOT_ID, username: 'claude', bot: true })
  const channel = mkChannel({ messages: { '222': mine } })
  const msg = mkMsg({ authorId: REINIER, channel, reference: { messageId: '222' } })
  const meta = await inboundMeta(msg, [], defaultAccess())
  expect(meta.reply_to_user_id).toBe(BOT_ID)
  expect(meta.mentions_bot).toBe('true')
})

test('an @mention of the bot sets mentions_bot and lists every mentioned id', async () => {
  const msg = mkMsg({ authorId: TORAN, mentionsBot: true, mentions: [REINIER] })
  const meta = await inboundMeta(msg, [], defaultAccess())
  expect(meta.mentions_bot).toBe('true')
  expect(meta.mentions!.split(',').sort()).toEqual([REINIER, BOT_ID].sort())
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
  const meta = await inboundMeta(mkMsg({ channel, authorId: REINIER }), [], defaultAccess())
  expect(meta.mentions_bot).toBe('true')
  expect(meta.channel_name).toBeUndefined()
})

test('a mention pattern counts as a mention', async () => {
  const access = { ...defaultAccess(), mentionPatterns: ['^hey claude\\b'] }
  const msg = mkMsg({ authorId: TORAN, content: 'hey claude can you check CI' })
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
