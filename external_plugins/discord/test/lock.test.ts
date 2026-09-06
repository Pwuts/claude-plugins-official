import { expect, test, afterAll } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import './harness'
import { acquireInstanceLock } from '../server'

const dirs: string[] = []
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'discord-lock-'))
  dirs.push(d)
  return d
}
afterAll(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })))

/** A pid that is definitely not running: walk down from the pid ceiling. */
function deadPid(): number {
  for (let pid = 4194303; pid > 4194000; pid--) {
    try {
      process.kill(pid, 0)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return pid
    }
  }
  throw new Error('no free pid found')
}

test('the first instance takes the lock and records its pid', () => {
  const dir = scratch()
  const lock = acquireInstanceLock(dir)
  expect(lock.ok).toBe(true)
  expect(JSON.parse(readFileSync(join(dir, 'instance.lock'), 'utf8')).pid).toBe(process.pid)
})

test('a second instance on the same state dir is refused, and names the holder', () => {
  const dir = scratch()
  expect(acquireInstanceLock(dir).ok).toBe(true)
  const second = acquireInstanceLock(dir)
  expect(second.ok).toBe(false)
  expect(second.ok === false && second.holder?.pid).toBe(process.pid)
})

test('two state dirs run side by side', () => {
  expect(acquireInstanceLock(scratch()).ok).toBe(true)
  expect(acquireInstanceLock(scratch()).ok).toBe(true)
})

test('a lock left by a dead process is taken over', () => {
  const dir = scratch()
  writeFileSync(join(dir, 'instance.lock'), JSON.stringify({ pid: deadPid(), startedAt: 'yesterday' }))
  const lock = acquireInstanceLock(dir)
  expect(lock.ok).toBe(true)
  expect(JSON.parse(readFileSync(join(dir, 'instance.lock'), 'utf8')).pid).toBe(process.pid)
})

test('an unreadable lock file is treated as stale, not as a holder', () => {
  const dir = scratch()
  writeFileSync(join(dir, 'instance.lock'), 'not json at all')
  expect(acquireInstanceLock(dir).ok).toBe(true)
})

test('release removes our own lock and leaves someone else\'s', () => {
  const dir = scratch()
  const lock = acquireInstanceLock(dir)
  expect(lock.ok).toBe(true)
  if (lock.ok) lock.release()
  expect(existsSync(join(dir, 'instance.lock'))).toBe(false)

  const other = { pid: deadPid(), startedAt: 'yesterday' }
  writeFileSync(join(dir, 'instance.lock'), JSON.stringify(other))
  if (lock.ok) lock.release()
  expect(JSON.parse(readFileSync(join(dir, 'instance.lock'), 'utf8')).pid).toBe(other.pid)
})
