import { describe, expect, it } from 'vitest'
import { BIG_RESULT, formatBytes, sizeOf, spawnName, Trail, trailLine } from '@shared/stalls'

const at = (s: number): number => new Date(2026, 10, 27, 12, 0, s).getTime()

describe('stall trail', () => {
  it('keeps the last entries only', () => {
    const t = new Trail(3)
    for (let i = 0; i < 5; i++) t.add({ at: at(i), what: `c:${i}`, ms: 1 })
    expect(t.take(at(10)).map((l) => l.split(' ')[1])).toEqual(['c:2', 'c:3', 'c:4'])
  })

  it('writes what ran before a stall under it once, and what is still running', () => {
    const t = new Trail(20)
    const a = t.start('gh:prReview', at(0))
    t.end(a, 41 * 1024 * 1024 + 1, at(2) + 300)
    t.end(t.start('fs:readDir', at(1)), 100, at(1) + 4)
    t.start('git:prWorktree', at(2))
    expect(t.take(at(4))).toEqual(['12:00:00.000 gh:prReview 41 MB 2.3 s', '12:00:01.000 fs:readDir 4 ms', '12:00:02.000 git:prWorktree still running after 2.0 s'])
    // the next stall: only what finished since, and what still runs
    t.end(t.start('pty:spawn copilot', at(5)), undefined, at(5) + 800)
    expect(t.take(at(6))).toEqual(['12:00:05.000 pty:spawn copilot 800 ms', '12:00:02.000 git:prWorktree still running after 4.0 s'])
  })

  it('gives a size only to big results', () => {
    const t = new Trail()
    t.end(t.start('x', at(0)), BIG_RESULT - 1, at(0))
    t.end(t.start('y', at(0)), BIG_RESULT, at(0))
    expect(t.take(at(1))).toEqual(['12:00:00.000 x 0 ms', '12:00:00.000 y 64 KB 0 ms'])
    expect(trailLine({ at: at(0), what: 'z', ms: 12_345, bytes: 3 * 1024 * 1024 })).toBe('12:00:00.000 z 3.0 MB 12.3 s')
    expect(formatBytes(120 * 1024 * 1024)).toBe('120 MB')
  })

  it('sizes a result without serialising it', () => {
    expect(sizeOf('x'.repeat(1000))).toBe(1000)
    expect(sizeOf({ number: 1, title: 'ab', diff: 'x'.repeat(500) })).toBe(502)
    expect(sizeOf([{ path: 'abc' }, { path: 'de' }])).toBe(5)
    expect(sizeOf(new Uint8Array(10))).toBe(10)
    expect(sizeOf(null)).toBe(0)
    // a huge list is looked at only so far
    expect(sizeOf(Array.from({ length: 100_000 }, () => 'ab'))).toBeLessThan(20_000)
  })

  it('names a pty by its program only, never its path or arguments', () => {
    expect(spawnName(['/home/me/.npm/bin/copilot', '--prompt', 'secret plan'])).toBe('copilot')
    expect(spawnName(['C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd', 'x'])).toBe('codex')
    expect(spawnName('npm run dev')).toBe('shell')
    expect(spawnName(undefined)).toBe('shell')
  })
})
