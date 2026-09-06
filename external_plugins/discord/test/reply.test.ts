import { expect, test, beforeEach, afterAll } from 'bun:test'
import { MessageFlags } from 'discord.js'
import { BOT_ID, cleanup, mkChannel, writeAccess } from './harness'
import { callTool, client } from '../server'

client.user = { id: BOT_ID, username: 'claude' } as any

const CHANNEL = '200000000000000001'
const OWNER = '510000000000000001'

function serveChannels(...chans: any[]): void {
  const byId = new Map(chans.map(c => [c.id, c]))
  client.channels.fetch = (async (id: string) => byId.get(id) ?? null) as any
}

beforeEach(() => {
  writeAccess({
    dmPolicy: 'allowlist',
    allowFrom: [OWNER],
    groups: { [CHANNEL]: { requireMention: false, allowFrom: [] } },
  })
})
afterAll(cleanup)

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
    allowFrom: [OWNER],
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
