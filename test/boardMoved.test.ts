import { describe, expect, it } from 'vitest'
import { baseMovedBadge, baseMovedCleared, baseMovedDetail, baseMovedShort, baseMovedStrong, boardFileText, flagBaseMoved, followPr, mergeBoardFile, moveItem, parseBoardFile, sameBase, type BoardItem } from '@shared/board'

let n = 0
const item = (patch: Partial<BoardItem> = {}): BoardItem => {
  n++
  return { id: `i${n}`, root: '/p', key: n, title: `Item ${n}`, body: '', column: 'review', labels: [], priority: 'normal', createdAt: n, updatedAt: n, order: n, ...patch }
}

describe('base moved: a merged PR flags the cards still in Review', () => {
  const merged = item({ key: 2, column: 'done' })
  const mergedFacts = { base: 'master', files: ['src/a.ts', 'src/b.ts'] }

  it('flags other Review cards on the same base, without touching updatedAt', () => {
    const plain = item({ key: 7 })
    const other = item({ key: 8 })
    const ready = item({ key: 9, column: 'ready' })
    const facts = { [plain.id]: { base: 'origin/master', files: ['README.md'], head: 'h7' }, [other.id]: { base: 'develop', files: ['src/a.ts'] }, [ready.id]: { base: 'master', files: [] } }
    const out = flagBaseMoved([merged, plain, other, ready], merged, mergedFacts, facts, 100)
    const p = out.find((i) => i.id === plain.id)!
    expect(p.baseMoved).toEqual({ base: 'master', cards: [2], files: [], after: false, head: 'h7', at: 100 })
    expect(p.updatedAt).toBe(plain.updatedAt)
    expect(baseMovedStrong(p.baseMoved!)).toBe(false)
    expect(baseMovedBadge(p.baseMoved!)).toBe('master moved: re-check')
    expect(baseMovedShort(p.baseMoved!)).toBe('#2 merged')
    // another base, another column, the merged card itself: untouched
    expect(out.find((i) => i.id === other.id)!.baseMoved).toBeUndefined()
    expect(out.find((i) => i.id === ready.id)!.baseMoved).toBeUndefined()
    expect(out.find((i) => i.id === merged.id)!.baseMoved).toBeUndefined()
  })

  it('says which files it shares with the merged PR, and when it was after it', () => {
    const sharing = item({ key: 10 })
    const after = item({ key: 11, blockedBy: [2] })
    const unknown = item({ key: 12 })
    const facts = { [sharing.id]: { base: 'master', files: ['src/b.ts', 'src/c.ts', 'src/a.ts'] }, [after.id]: { base: 'master', files: null } }
    const out = flagBaseMoved([merged, sharing, after, unknown], merged, mergedFacts, facts, 100)
    const s = out.find((i) => i.id === sharing.id)!.baseMoved!
    expect(s.files).toEqual(['src/a.ts', 'src/b.ts'])
    expect(baseMovedStrong(s)).toBe(true)
    expect(baseMovedShort(s)).toBe('shares 2 files with #2')
    expect(baseMovedDetail(s)).toContain('shares 2 files with it: src/a.ts, src/b.ts')
    const a = out.find((i) => i.id === after.id)!.baseMoved!
    expect(a.after).toBe(true)
    expect(baseMovedShort(a)).toBe('was waiting for #2')
    // a card whose branch the board doesn't know is left alone
    expect(out.find((i) => i.id === unknown.id)!.baseMoved).toBeUndefined()
  })

  it('a second merge adds to the flag and takes the newest head', () => {
    const c = item({ key: 13, baseMoved: { base: 'master', cards: [2], files: ['src/a.ts'], after: false, head: 'old', at: 1 } })
    const three = item({ key: 3, column: 'done' })
    const out = flagBaseMoved([c, three], three, { base: 'master', files: ['src/z.ts'] }, { [c.id]: { base: 'master', files: ['src/z.ts', 'src/a.ts'], head: 'new' } }, 5)
    expect(out[0].baseMoved).toMatchObject({ cards: [2, 3], files: ['src/a.ts', 'src/z.ts'], head: 'new', at: 5 })
  })

  it('clears once the branch moved on and is no longer behind', () => {
    const flag = { base: 'master', cards: [2], files: [], after: false, head: 'h1', at: 1 }
    expect(baseMovedCleared(flag, 'h1', 0)).toBe(false) // not updated yet (a stale fetch can say 0 behind)
    expect(baseMovedCleared(flag, 'h2', 1)).toBe(false) // a new commit, still behind
    expect(baseMovedCleared(flag, 'h2', 0)).toBe(true)
    expect(baseMovedCleared(flag, null, 0)).toBe(false)
  })

  it('leaving Review, or its own PR merging, drops the flag', () => {
    const flag = { base: 'master', cards: [2], files: [], after: false, at: 1 }
    const c = item({ key: 14, baseMoved: flag })
    expect(moveItem(c, 'done', 10).baseMoved).toBeUndefined()
    expect(moveItem(c, 'review', 10).baseMoved).toEqual(flag)
    expect(followPr(c, { number: 5, state: 'MERGED' }, 10)!.baseMoved).toBeUndefined()
  })

  it('never reaches the shared board file, and the file never clears it', () => {
    const c = item({ key: 15 })
    const flagged = flagBaseMoved([c], merged, mergedFacts, { [c.id]: { base: 'master', files: ['src/a.ts'] } }, 100)
    expect(flagged[0].baseMoved).toBeDefined()
    const text = boardFileText(flagged, '/p')
    expect(text).toBe(boardFileText([c], '/p'))
    expect(text).not.toContain('baseMoved')
    // reading the same file back keeps the local flag
    const back = mergeBoardFile(flagged, '/p', parseBoardFile(text).file!)
    expect(back.items[0].baseMoved).toBeDefined()
  })

  it('compares bases by name', () => {
    expect(sameBase('origin/master', 'master')).toBe(true)
    expect(sameBase('refs/heads/main', 'main')).toBe(true)
    expect(sameBase('main', 'master')).toBe(false)
    expect(sameBase('', '')).toBe(false)
  })
})
