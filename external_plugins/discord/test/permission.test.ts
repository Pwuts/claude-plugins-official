import { expect, test, beforeEach, afterAll } from 'bun:test'
import { BOT_ID, captureNotifications, cleanup, mkMsg, writeAccess } from './harness'
import { client, handleInbound, mcp } from '../server'

client.user = { id: BOT_ID, username: 'claude' } as any

const CHANNEL = '200000000000000001'
const OWNER = '510000000000000001'
const STRANGER = '800000000000000001'

beforeEach(() => {
  writeAccess({
    dmPolicy: 'allowlist',
    allowFrom: [OWNER],
    groups: { [CHANNEL]: { requireMention: false, allowFrom: [] } },
  })
})
afterAll(cleanup)

test('a permission reply from the DM allowlist is acted on', async () => {
  const cap = captureNotifications(mcp)
  await handleInbound(mkMsg({ authorId: OWNER, username: 'owner', content: 'y abcde' }))
  expect(cap.notes.at(-1).method).toBe('notifications/claude/channel/permission')
  expect(cap.notes.at(-1).params).toEqual({ request_id: 'abcde', behavior: 'allow' })
  cap.restore()
})

test('the same text from anyone else is relayed as ordinary chat', async () => {
  const cap = captureNotifications(mcp)
  await handleInbound(mkMsg({ authorId: STRANGER, username: 'stranger', content: 'y abcde' }))
  expect(cap.notes.at(-1).method).toBe('notifications/claude/channel')
  cap.restore()
})
