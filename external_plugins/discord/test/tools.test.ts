import { expect, test, beforeEach, afterAll } from 'bun:test'
import { ChannelType, MessageFlags } from 'discord.js'
import { BOT_ID, cleanup, mkChannel, mkMsg, writeAccess } from './harness'
import { callTool, client, gate } from '../server'

client.user = { id: BOT_ID, username: 'claude' } as any

const CHANNEL = '200000000000000001'
const REINIER = '244903587505897472'

function serveChannels(...chans: any[]): void {
  const byId = new Map(chans.map(c => [c.id, c]))
  client.channels.fetch = (async (id: string) => byId.get(id) ?? null) as any
}

function text(res: any): string {
  return res.content[0].text
}

beforeEach(() => {
  writeAccess({
    dmPolicy: 'allowlist',
    allowFrom: [REINIER],
    groups: { [CHANNEL]: { requireMention: false, allowFrom: [] } },
  })
})
afterAll(cleanup)

test('create_thread branches off a message and returns the thread id', async () => {
  const parent = mkMsg({ id: '777' })
  const ch = mkChannel({ id: CHANNEL, messages: { '777': parent } })
  serveChannels(ch)
  const res = await callTool('create_thread', { channel_id: CHANNEL, message_id: '777', name: 'CI is red' })
  expect(res.isError).toBeUndefined()
  expect(text(res)).toContain('300000000000000009')
  expect(parent.startedThread).toEqual({ name: 'CI is red', autoArchiveDuration: 4320 })
})

test('create_thread without a message_id creates a standalone thread', async () => {
  const ch = mkChannel({ id: CHANNEL })
  serveChannels(ch)
  await callTool('create_thread', { channel_id: CHANNEL, name: 'standup', auto_archive_duration: 1440 })
  expect(ch.threadsCreated).toEqual([{ name: 'standup', autoArchiveDuration: 1440 }])
})

test('create_thread rejects an auto_archive_duration Discord does not accept', async () => {
  serveChannels(mkChannel({ id: CHANNEL }))
  const res = await callTool('create_thread', { channel_id: CHANNEL, name: 'x', auto_archive_duration: 120 })
  expect(res.isError).toBe(true)
  expect(text(res)).toContain('60, 1440, 4320, 10080')
})

test('create_thread refuses a channel that is not allowlisted', async () => {
  serveChannels(mkChannel({ id: '999999999999999999' }))
  const res = await callTool('create_thread', { channel_id: '999999999999999999', name: 'x' })
  expect(res.isError).toBe(true)
  expect(text(res)).toContain('not allowlisted')
})

test('create_thread refuses a thread as its parent', async () => {
  const thread = mkChannel({ id: '300000000000000001', type: ChannelType.PublicThread, parentId: CHANNEL })
  serveChannels(thread)
  const res = await callTool('create_thread', { channel_id: '300000000000000001', name: 'x' })
  expect(res.isError).toBe(true)
  expect(text(res)).toContain('does not take threads')
})

test('a message in a new thread delivers on the parent channel opt-in', async () => {
  const thread = mkChannel({ id: '300000000000000009', type: ChannelType.PublicThread, parentId: CHANNEL })
  const result = await gate(mkMsg({ channel: thread, authorId: REINIER }))
  expect(result.action).toBe('deliver')
})

test('create_thread on a deleted message says so instead of "Unknown Message"', async () => {
  serveChannels(mkChannel({ id: CHANNEL, messages: {} }))
  const res = await callTool('create_thread', { channel_id: CHANNEL, message_id: '404', name: 'x' })
  expect(res.isError).toBe(true)
  expect(text(res)).toContain('no longer exists')
})

test('delete_message removes a message the bot sent', async () => {
  const mine = mkMsg({ id: '888', authorId: BOT_ID, username: 'claude', bot: true })
  serveChannels(mkChannel({ id: CHANNEL, messages: { '888': mine } }))
  const res = await callTool('delete_message', { chat_id: CHANNEL, message_id: '888' })
  expect(res.isError).toBeUndefined()
  expect(mine.deleted).toBe(true)
})

test('delete_message refuses someone else\'s message', async () => {
  const theirs = mkMsg({ id: '889', authorId: REINIER, username: 'Pwuts' })
  serveChannels(mkChannel({ id: CHANNEL, messages: { '889': theirs } }))
  const res = await callTool('delete_message', { chat_id: CHANNEL, message_id: '889' })
  expect(res.isError).toBe(true)
  expect(text(res)).toContain('did not send')
  expect(theirs.deleted).toBeUndefined()
})

test('reply strips link previews by default and on request keeps them', async () => {
  const ch = mkChannel({ id: CHANNEL })
  serveChannels(ch)
  await callTool('reply', { chat_id: CHANNEL, text: 'see https://github.com/x/y/pull/1' })
  expect(ch.sent[0].flags).toBe(MessageFlags.SuppressEmbeds)

  await callTool('reply', { chat_id: CHANNEL, text: 'look at this', suppress_embeds: false })
  expect(ch.sent[1].flags).toBeUndefined()
})

test('suppressEmbeds in access.json flips the default, and the parameter still wins', async () => {
  writeAccess({
    dmPolicy: 'allowlist',
    allowFrom: [REINIER],
    groups: { [CHANNEL]: { requireMention: false, allowFrom: [] } },
    suppressEmbeds: false,
  })
  const ch = mkChannel({ id: CHANNEL })
  serveChannels(ch)
  await callTool('reply', { chat_id: CHANNEL, text: 'a' })
  expect(ch.sent[0].flags).toBeUndefined()

  await callTool('reply', { chat_id: CHANNEL, text: 'b', suppress_embeds: true })
  expect(ch.sent[1].flags).toBe(MessageFlags.SuppressEmbeds)
})

test('every chunk of a split reply gets the flag', async () => {
  const ch = mkChannel({ id: CHANNEL })
  serveChannels(ch)
  await callTool('reply', { chat_id: CHANNEL, text: 'x'.repeat(2500) })
  expect(ch.sent.length).toBe(2)
  expect(ch.sent.map((s: any) => s.flags)).toEqual([MessageFlags.SuppressEmbeds, MessageFlags.SuppressEmbeds])
})

test('fetch_messages pages back with before', async () => {
  const ch = mkChannel({ id: CHANNEL, messages: { '5': mkMsg({ id: '5', content: 'older' }) } })
  serveChannels(ch)
  await callTool('fetch_messages', { channel: CHANNEL, limit: 5, before: '10' })
  expect(ch.messages.calls.at(-1)).toEqual({ limit: 5, before: '10' })

  await callTool('fetch_messages', { channel: CHANNEL })
  expect(ch.messages.calls.at(-1)).toEqual({ limit: 20 })
})

test('list_threads reports active and archived threads', async () => {
  const ch = mkChannel({ id: CHANNEL })
  ch.threads.active.set('1', { id: '1', name: 'CI is red' })
  ch.threads.archived.set('2', { id: '2', name: 'old standup' })
  serveChannels(ch)
  const out = text(await callTool('list_threads', { channel_id: CHANNEL }))
  expect(out).toContain('CI is red  (id: 1)')
  expect(out).toContain('old standup  (id: 2, archived)')
})

test('list_threads says so when there are none', async () => {
  serveChannels(mkChannel({ id: CHANNEL }))
  expect(text(await callTool('list_threads', { channel_id: CHANNEL }))).toBe('(no threads)')
})

test.each(['react', 'edit_message', 'delete_message', 'download_attachment'])(
  '%s reports a deleted message as gone',
  async tool => {
    serveChannels(mkChannel({ id: CHANNEL, messages: {} }))
    const res = await callTool(tool, { chat_id: CHANNEL, message_id: '404', text: 'x', emoji: '👍' })
    expect(res.isError).toBe(true)
    expect(text(res)).toContain('no longer exists')
  },
)
