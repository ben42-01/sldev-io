import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonStore } from '../src/main/store'
import { askPrompt, findPrReview, prReviewKey, putPrReview, targetOf, walkthroughPrompt, type Part } from '@shared/review'
import type { StoreFiles } from '@shared/types'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('review state of pull requests', () => {
  it('keys a PR by its repository and number', () => {
    expect(prReviewKey('/w/app/', 12)).toBe(prReviewKey('/w/app', 12))
    expect(prReviewKey('/w/app', 12)).not.toBe(prReviewKey('/w/other', 12))
    expect(prReviewKey('/w/app', 12)).not.toBe(prReviewKey('/w/app', 13))
  })

  it('adds, updates and keeps the head the marks were made on', () => {
    let list = putPrReview([], '/w/app', 7, (r) => ({ ...r, marks: { a: { ok: true } } }), 'abc', 1)
    list = putPrReview(list, '/w/other', 7, (r) => ({ ...r, marks: { b: { note: 'no' } } }), 'zzz', 2)
    list = putPrReview(list, '/w/app', 7, (r) => ({ ...r, marks: { ...r.marks, c: { note: 'simpler' } } }), undefined, 3)
    expect(list).toHaveLength(2)
    const app = findPrReview(list, '/w/app', 7)!
    expect(app.head).toBe('abc')
    expect(app.updatedAt).toBe(3)
    expect(app.review.marks).toEqual({ a: { ok: true }, c: { note: 'simpler' } })
    expect(putPrReview(list, '/w/app', 7, (r) => r, 'def', 4).find((r) => r.root === '/w/app')?.head).toBe('def')
  })

  it('round-trips through prReviews.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sldev-prreviews-'))
    dirs.push(dir)
    const reviews = putPrReview([], '/w/app', 42, () => ({
      walk: { file: '/w/app/.sldev/runs/review-pr-42/walkthrough-x.json', mission: 'h1', agent: 'codex', status: 'ready', at: 5, diff: '3:20' },
      marks: { 'part-1': { ok: true }, 'part-2': { note: 'drop the option' } },
      asks: [{ id: 'q1', part: 'part-2', q: 'why?', file: '/f.md', mission: 'h2', agent: 'claude', a: 'it is not needed', at: 6 }]
    }), 'cafe1234', 9)
    const a = new JsonStore<StoreFiles['prReviews']>(dir, 'prReviews', { reviews: [] })
    a.set({ reviews })
    a.flush()
    expect(JSON.parse(readFileSync(join(dir, 'prReviews.json'), 'utf8')).reviews[0].head).toBe('cafe1234')
    const b = new JsonStore<StoreFiles['prReviews']>(dir, 'prReviews', { reviews: [] })
    expect(b.get().reviews).toEqual(reviews)
    expect(findPrReview(b.get().reviews, '/w/app', 42)?.review.marks?.['part-2']).toEqual({ note: 'drop the option' })
  })
})

describe('review targets', () => {
  it('reads a layout saved before targets (only a missionId)', () => {
    expect(targetOf({ missionId: 'm1' })).toEqual({ kind: 'mission', id: 'm1' })
    expect(targetOf({ target: { kind: 'pr', number: 3, root: '/w' } })).toEqual({ kind: 'pr', number: 3, root: '/w' })
    expect(targetOf({})).toBeUndefined()
  })

  it('tells helpers how to see a PR, and missions what they were told before', () => {
    const part = { id: 'p', title: 'P', why: '', need: 'asked', hunks: [], lines: 0, flags: [] } as unknown as Part
    const pr = { title: 'PR', criteria: [], base: 'origin/main', diff: 'gh pr diff 3' }
    expect(walkthroughPrompt(pr, [], '/f.json')).toContain('The change is `gh pr diff 3`.')
    expect(askPrompt(pr, part, 'why?', '/f.md')).toContain('The whole change is `gh pr diff 3`;')
    const m = { title: 'M', criteria: [], base: 'abc' }
    expect(walkthroughPrompt(m, [], '/f.json')).toContain('The change is `git diff abc` plus untracked files in this folder.')
    expect(askPrompt(m, part, 'why?', '/f.md')).toContain('The whole change is `git diff abc`;')
  })
})
