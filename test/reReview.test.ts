import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseDiff } from '@shared/diff'
import { buildCockpit, carryMarks, hunkKey, markOn, movedText, nextSeen, seenNow, sinceReview, type Cockpit, type Walkthrough } from '@shared/review'
import type { ReviewState } from '@shared/types'
import { commitsSince } from '../src/main/git'

/** A diff of two files, one hunk each: app.ts (the asked change) and util.ts (a helper). */
const diff = (app: string, util: string, more = ''): string =>
  [
    'diff --git a/src/app.ts b/src/app.ts',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,3 +1,3 @@',
    ' import { x } from "./x"',
    "-console.log('hi')",
    `+console.log('${app}')`,
    ' export {}',
    'diff --git a/src/util.ts b/src/util.ts',
    '--- a/src/util.ts',
    '+++ b/src/util.ts',
    '@@ -10,2 +10,3 @@',
    ' export const a = 1',
    `+export const b = ${util}`,
    ' export const c = 3',
    more
  ]
    .filter(Boolean)
    .join('\n') + '\n'

const walk: Walkthrough = {
  parts: [
    { title: 'The greeting', need: 'asked', files: [{ path: 'src/app.ts' }] },
    { title: 'A helper', need: 'supports', files: [{ path: 'src/util.ts' }] }
  ]
}
const cockpit = (text: string): Cockpit => buildCockpit(parseDiff(text), walk, [])
const all = (c: Cockpit) => [...c.parts.flatMap((p) => p.hunks), ...c.noise]

/** The reviewer approves every part of `c`, one after the other, as the cockpit does. */
function approveAll(c: Cockpit, r: ReviewState = {}, head = 'h1'): ReviewState {
  for (const p of c.parts) r = { ...r, marks: { ...r.marks, [p.id]: markOn(p, { ok: true }, head, 1) }, seen: nextSeen(r.seen, p, all(c), head, 1) }
  return r
}

describe('hunk keys', () => {
  it('ignore where a hunk sits, but not a byte of what it changes', () => {
    const a = cockpit(diff('hello', '2')).parts[1].hunks[0]
    const moved = cockpit(diff('hello', '2').replace('@@ -10,2 +10,3 @@', '@@ -40,2 +44,3 @@')).parts[1].hunks[0]
    const changed = cockpit(diff('hello', '2 ')).parts[1].hunks[0]
    expect(hunkKey(moved)).toBe(hunkKey(a))
    expect(hunkKey(changed)).not.toBe(hunkKey(a))
  })
})

describe('carrying marks across two diffs', () => {
  const v1 = cockpit(diff('hello', '2'))
  const reviewed = approveAll(v1)

  it('keeps every mark while nothing changed', () => {
    const r = carryMarks(cockpit(diff('hello', '2')).parts, reviewed.marks)
    expect(Object.keys(r.marks).sort()).toEqual(['a-helper', 'the-greeting'])
    expect(r.changed).toEqual({})
  })

  it('keeps the ✓ on the unchanged part and drops it, with the reason, on the changed one', () => {
    const v2 = cockpit(diff('hello there', '2'))
    const r = carryMarks(v2.parts, reviewed.marks)
    expect(r.marks['a-helper']?.ok).toBe(true)
    expect(r.marks['the-greeting']).toBeUndefined()
    expect(r.changed).toEqual({ 'the-greeting': 'approved' })
  })

  it('says a part that was sent back changed since then', () => {
    const p = v1.parts[0]
    const marks = { [p.id]: markOn(p, { note: 'say friend' }, 'h1', 1) }
    expect(carryMarks(cockpit(diff('hello friend', '2')).parts, marks).changed).toEqual({ 'the-greeting': 'sent back' })
  })

  it('treats a part that gained a hunk as changed', () => {
    const extra = ['@@ -30,1 +31,2 @@', ' export const z = 0', '+export const y = 9'].join('\n')
    const r = carryMarks(cockpit(diff('hello', '2', extra)).parts, reviewed.marks)
    expect(r.changed).toEqual({ 'a-helper': 'approved' })
    expect(r.marks['the-greeting']?.ok).toBe(true)
  })

  it('keeps marks saved before they carried their hunks', () => {
    expect(carryMarks(cockpit(diff('x', 'y')).parts, { 'the-greeting': { ok: true } }).marks['the-greeting']).toEqual({ ok: true })
  })
})

describe('since last review', () => {
  const v1 = cockpit(diff('hello', '2'))
  const reviewed = approveAll(v1)

  it('is nothing before the first verdict, and nothing new while the diff is the same', () => {
    expect(sinceReview(v1, undefined)).toBeNull()
    expect(sinceReview(cockpit(diff('hello', '2')), reviewed.seen)).toMatchObject({ parts: [], fresh: 0, gone: 0 })
  })

  it('shows only the hunks that changed', () => {
    const d = sinceReview(cockpit(diff('hello there', '2')), reviewed.seen)!
    expect(d.parts.map((p) => p.id)).toEqual(['the-greeting'])
    expect(d.parts[0].hunks).toHaveLength(1)
    expect(d.fresh).toBe(1)
    expect(d.gone).toBe(1)
  })

  it('keeps the other changed parts in view until each gets a verdict, then starts again', () => {
    const v2 = cockpit(diff('hello there', '3'))
    let r: ReviewState = reviewed
    const greeting = v2.parts[0]
    r = { ...r, seen: nextSeen(r.seen, greeting, all(v2), 'h2', 2) }
    expect(sinceReview(v2, r.seen)!.parts.map((p) => p.id)).toEqual(['a-helper'])
    expect(r.seen!.head).toBe('h1')
    r = { ...r, seen: nextSeen(r.seen, v2.parts[1], all(v2), 'h2', 3) }
    expect(sinceReview(v2, r.seen)).toMatchObject({ parts: [], fresh: 0, gone: 0 })
    expect(r.seen).toEqual(seenNow(all(v2), 'h2', 3))
  })

  it('says how the head moved', () => {
    expect(movedText('a', 'b', 3)).toBe('3 new commits since you reviewed')
    expect(movedText('a', 'b', 1)).toBe('1 new commit since you reviewed')
    expect(movedText('a', 'b', null)).toBe('The branch was rewritten since you reviewed')
    expect(movedText('a', 'a', 0)).toBe('The change moved on since you reviewed')
  })
})

describe('commitsSince', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
  const g = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim()

  it('counts commits after the reviewed head, and is null once it left the history', async () => {
    const d = mkdtempSync(join(tmpdir(), 'sldev-rerev-'))
    dirs.push(d)
    g(d, 'init', '-q')
    const commit = (s: string): string => (writeFileSync(join(d, 'f.txt'), s), g(d, 'add', '-A'), g(d, 'commit', '-qm', s), g(d, 'rev-parse', 'HEAD'))
    const a = commit('a')
    commit('b')
    commit('c')
    expect(await commitsSince(d, a)).toBe(2)
    g(d, 'checkout', '-q', '--orphan', 'other')
    commit('z')
    expect(await commitsSince(d, a)).toBeNull()
    expect(await commitsSince(d, '--all')).toBeNull()
  })
})
