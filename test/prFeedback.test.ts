import { describe, expect, it } from 'vitest'
import { feedbackPrompt, prNumber, unaddressed } from '@shared/prFeedback'
import type { GhPrComment } from '@shared/types'

const c = (id: string, createdAt: string, body = `comment ${id}`, extra: Partial<GhPrComment> = {}): GhPrComment => ({ id, author: 'rev', body, createdAt, url: '', ...extra })

describe('PR feedback loop', () => {
  it('reads the PR number from the URL gh pr create prints', () => {
    expect(prNumber('https://github.com/acme/shop/pull/123\n')).toBe(123)
    expect(prNumber('https://github.com/acme/shop/pull/7/')).toBe(7)
    expect(prNumber('Pull request opened')).toBeNull()
  })

  it('keeps comments newer than the last hand-over, oldest first, and drops empty reviews', () => {
    const list = [c('b', '2026-10-26T12:00:00Z'), c('a', '2026-10-26T10:00:00Z'), c('approve', '2026-10-26T13:00:00Z', ''), c('old', '2026-10-25T10:00:00Z')]
    expect(unaddressed(list, undefined).map((x) => x.id)).toEqual(['old', 'a', 'b'])
    expect(unaddressed(list, Date.parse('2026-10-26T11:00:00Z')).map((x) => x.id)).toEqual(['b'])
  })

  it('lists every comment with where it was made, and tells the agent not to push', () => {
    const p = feedbackPrompt('Add CSV export', 12, [c('1', '2026-10-26T10:00:00Z', 'Rename this.\nIt is unclear.', { path: 'src/csv.ts', line: 4 }), c('2', '2026-10-26T11:00:00Z', 'Add a test')])
    expect(p).toContain('Pull request #12 ("Add CSV export")')
    expect(p).toContain('1. rev on src/csv.ts:4:\n   Rename this.\n   It is unclear.')
    expect(p).toContain('2. rev:\n   Add a test')
    expect(p).toContain('Do not push')
  })
})
