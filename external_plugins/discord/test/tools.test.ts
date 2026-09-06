import { expect, test, beforeEach, afterAll } from 'bun:test'
import { ChannelType } from 'discord.js'
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
