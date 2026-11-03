import { expect, test } from 'bun:test'
import './harness'
import { channelHost, launchedAsChannel } from '../server'

// Argv as /proc shows it on this machine (Claude Code 2.1.317).
const VSCODE_ORCHESTRATOR = [
  '/home/u/.vscode/extensions/anthropic.claude-code-2.1.317-linux-x64/resources/native-binary/claude',
  '--output-format', 'stream-json', '--input-format', 'stream-json', '--permission-mode=auto',
  '--channels', 'plugin:discord@pwuts-plugins',
]
const BG_SPARE = ['claude bg-spare', '--bg-spare', '/tmp/cc-daemon-1000/x/spare/58ab8677.claim.sock']

test.each([
  ['the --channels session', VSCODE_ORCHESTRATOR, true],
  ['--channels=, among several', ['claude', '--channels=server:other,plugin:discord@m'], true],
  ['several space-separated channels', ['claude', '--channels', 'plugin:telegram@m', 'plugin:discord', '--verbose'], true],
  ['a local marketplace\'s development-channels flag', ['claude', '--dangerously-load-development-channels', 'plugin:discord@mine'], true],
  ['a background spare', BG_SPARE, false],
  ['another plugin\'s channel', ['claude', '--channels', 'plugin:discordish@m'], false],
  ['a flag value that only mentions the plugin', ['claude', '--append-system-prompt', 'plugin:discord@m'], false],
])('%s → %p', (_, argv, expected) => {
  expect(launchedAsChannel(argv as string[])).toBe(expected)
})

/** A fake /proc: pid → [ppid, argv]. */
function proc(tree: Record<number, [number, string[]]>) {
  return { argv: (pid: number) => tree[pid]?.[1] ?? null, ppid: (pid: number) => tree[pid]?.[0] ?? null }
}
// The daemon above the spare carries --channels here so that a walk which skips
// past the spare to the next Claude process gets the wrong answer.
const underSpare = proc({
  30: [20, ['bun', 'run', '--cwd', '/p', 'start']],
  20: [10, BG_SPARE],
  10: [1, ['/home/u/.local/bin/claude', 'daemon', 'run', '--channels', 'plugin:discord@m']],
})
const underOrchestrator = proc({ 30: [20, ['bun', 'run', 'start']], 20: [10, VSCODE_ORCHESTRATOR], 10: [1, ['/usr/share/code/code']] })

test('the nearest Claude ancestor decides: a spare stands down, the --channels session connects', () => {
  expect(channelHost({}, 30, underSpare).ok).toBe(false)
  expect(channelHost({}, 30, underOrchestrator).ok).toBe(true)
})

test('DISCORD_CHANNEL_HOST overrides the check both ways', () => {
  expect(channelHost({ DISCORD_CHANNEL_HOST: '1' }, 30, underSpare).ok).toBe(true)
  expect(channelHost({ DISCORD_CHANNEL_HOST: '0' }, 30, underOrchestrator).ok).toBe(false)
})

test('with no Claude process among the parents, it connects as before', () => {
  expect(channelHost({}, 30, proc({ 30: [20, ['bun', 'server.ts']], 20: [1, ['bash']] })).ok).toBe(true)
  expect(channelHost({}, 30, proc({})).ok).toBe(true)
})
