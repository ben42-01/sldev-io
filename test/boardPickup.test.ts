import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { blockerText, blockersOf, defaultBoardSettings, followPr, holdsSlot, moveItem, nextPickups, type BoardItem } from '@shared/board'
import { pickupBase } from '../src/main/git'

let n = 0
const item = (patch: Partial<BoardItem> = {}): BoardItem => {
  n++
  return { id: `i${n}`, root: '/p', key: n, title: `Item ${n}`, body: '', column: 'ready', labels: [], priority: 'normal', createdAt: n, updatedAt: n, order: n, ...patch }
}
const on = { ...defaultBoardSettings('/p'), pickup: true }
const started = { type: 'mission' as const, id: 'm', at: 1 }

// card 12 finished into Review: with one at a time, card 13 must not start until 12's PR merged, or it branches
// from a base without 12's work and the two conflict
describe('pick-up waits until Done', () => {
  it('a card in Review with unmerged work holds its slot', () => {
    const inReview = item({ column: 'review', started, state: 'finished' })
    const next = item()
    expect(holdsSlot(inReview, on)).toBe(true)
    expect(nextPickups([inReview, next], on)).toEqual([])
    expect(nextPickups([inReview, next], { ...on, parallel: 2 }).map((i) => i.id)).toEqual([next.id])
  })
  it('its PR merging moves it to Done, and the next card starts', () => {
    const inReview = item({ column: 'review', started, state: 'finished' })
    const next = item()
    const merged = followPr(inReview, { number: 40, state: 'MERGED' }, 5)!
    expect(merged.column).toBe('done')
    expect(nextPickups([merged, next], on).map((i) => i.id)).toEqual([next.id])
  })
  it('off, the next card starts as soon as the agent finishes (as before)', () => {
    const inReview = item({ column: 'review', started, state: 'finished' })
    const next = item()
    expect(nextPickups([inReview, next], { ...on, waitForDone: false }).map((i) => i.id)).toEqual([next.id])
  })
  it('a card put in Review by hand, never started, holds nothing', () => {
    expect(holdsSlot(item({ column: 'review' }), on)).toBe(false)
  })
})

describe('a blocker clears only once its PR merged', () => {
  it('a blocker dragged to Done with its PR still open keeps the dependent waiting, and says why', () => {
    const a = item({ column: 'done', started, state: 'finished', pr: { number: 40, state: 'OPEN' } })
    const b = item({ blockedBy: [a.key] })
    expect(blockersOf(b, [a, b]).map((x) => x.id)).toEqual([a.id])
    expect(blockerText(a)).toBe(`#${a.key}'s PR #40 to merge`)
    expect(nextPickups([a, b], on)).toEqual([])
  })
  it('once that PR merged, the dependent is picked up', () => {
    const a = item({ column: 'done', started, state: 'finished', pr: { number: 40, state: 'OPEN' } })
    const b = item({ blockedBy: [a.key] })
    const merged = followPr(a, { number: 40, state: 'MERGED' }, 9)!
    expect(merged.column).toBe('done')
    expect(merged.pr?.state).toBe('MERGED')
    // only what gh said: not an edit of the card
    expect(merged.updatedAt).toBe(a.updatedAt)
    expect(nextPickups([merged, b], on).map((i) => i.id)).toEqual([b.id])
  })
  it('a Done card without a known PR (merged some other way) or with a closed one does not block', () => {
    const a = item({ column: 'done' })
    const c = item({ column: 'done', pr: { number: 41, state: 'CLOSED' } })
    expect(blockersOf(item({ blockedBy: [a.key, c.key] }), [a, c])).toEqual([])
  })
  it('an open PR found while the card is in Review is remembered, so dragging it to Done keeps it known', () => {
    const a = item({ column: 'review', started, state: 'finished' })
    const found = followPr(a, { number: 42, state: 'OPEN' }, 9)!
    expect(found.pr).toEqual({ number: 42, state: 'OPEN' })
    expect(followPr(found, { number: 42, state: 'OPEN' }, 10)).toBeNull()
    const done = moveItem(found, 'done', 11)
    expect(blockersOf(item({ blockedBy: [a.key] }), [done]).map((x) => x.id)).toEqual([a.id])
    // back to Agent ready forgets the old work and its PR
    expect(moveItem(found, 'ready', 12).pr).toBeUndefined()
  })
})

describe('pickupBase', () => {
  let tmp: string
  let work: string
  let other: string
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  const g = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const commit = (cwd: string, file: string): void => {
    writeFileSync(join(cwd, file), file + '\n')
    g(cwd, 'add', file)
    g(cwd, 'commit', '-q', '-m', file)
  }

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'sldev-pickupbase-'))
    const origin = join(tmp, 'origin.git')
    g(tmp, 'init', '-q', '--bare', '-b', 'master', origin)
    work = join(tmp, 'work')
    other = join(tmp, 'other')
    g(tmp, 'clone', '-q', origin, work)
    commit(work, 'a.txt')
    g(work, 'push', '-q', '-u', 'origin', 'master')
    g(tmp, 'clone', '-q', origin, other)
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('the local default branch when it is exactly the remote', async () => {
    expect(await pickupBase(work)).toEqual({ ref: 'master', commit: g(work, 'rev-parse', 'master') })
  })

  it('the default branch, not the feature branch the main checkout is on', async () => {
    g(work, 'checkout', '-q', '-b', 'someones-feature')
    commit(work, 'feature.txt')
    expect((await pickupBase(work)).ref).toBe('master')
    g(work, 'checkout', '-q', 'master')
  })

  it('fetches first: local master behind (a PR merged on GitHub) starts from origin/master', async () => {
    commit(other, 'merged-pr.txt')
    g(other, 'push', '-q', 'origin', 'master')
    const b = await pickupBase(work)
    expect(b).toEqual({ ref: 'origin/master', commit: g(other, 'rev-parse', 'HEAD') })
    // the user's checkout is left alone
    expect(g(work, 'log', '-1', '--format=%s')).toBe('a.txt')
  })

  it('local master diverged: still the remote, never local commits nobody merged', async () => {
    commit(work, 'local-only.txt')
    expect(await pickupBase(work)).toEqual({ ref: 'origin/master', commit: g(other, 'rev-parse', 'HEAD') })
  })

  it('a base set in the settings', async () => {
    g(other, 'checkout', '-q', '-b', 'develop')
    commit(other, 'develop.txt')
    g(other, 'push', '-q', 'origin', 'develop')
    expect(await pickupBase(work, 'develop')).toEqual({ ref: 'origin/develop', commit: g(other, 'rev-parse', 'HEAD') })
    await expect(pickupBase(work, 'nope')).rejects.toThrow(/no branch nope/)
  })

  it('a remote that cannot be fetched is an error, not a stale start', async () => {
    const lost = join(tmp, 'lost')
    g(tmp, 'clone', '-q', join(tmp, 'origin.git'), lost)
    g(lost, 'remote', 'set-url', 'origin', join(tmp, 'gone.git'))
    await expect(pickupBase(lost)).rejects.toThrow(/Couldn't fetch origin/)
  })

  it('a repository without a remote starts from its local default branch', async () => {
    const solo = join(tmp, 'solo')
    g(tmp, 'init', '-q', '-b', 'main', solo)
    commit(solo, 's.txt')
    g(solo, 'checkout', '-q', '-b', 'wip')
    expect(await pickupBase(solo)).toEqual({ ref: 'main', commit: g(solo, 'rev-parse', 'main') })
  })
})
