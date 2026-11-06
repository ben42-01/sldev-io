import { describe, expect, it } from 'vitest'
import { fuzzyMatches, fuzzyScore, pushRecent, withRecentFirst } from '../src/renderer/src/lib/fuzzy'

describe('fuzzyMatches', () => {
  it('marks the query as one run when the text contains it', () => {
    expect(fuzzyMatches('term', 'Split terminal right')).toEqual([6, 7, 8, 9])
    expect(fuzzyMatches('TERM', 'Split terminal right')).toEqual([6, 7, 8, 9])
  })
  it('falls back to the scattered letters fuzzyScore matched', () => {
    expect(fuzzyMatches('ntm', 'New terminal')).toEqual([0, 4, 7])
    expect(fuzzyScore('ntm', 'New terminal')).toBeGreaterThan(0)
  })
  it('ignores spaces in the query, so each word is marked', () => {
    expect(fuzzyMatches('new term', 'New terminal')).toEqual([0, 1, 2, 4, 5, 6, 7])
  })
  it('is null when fuzzyScore does not match either', () => {
    expect(fuzzyMatches('xyz', 'New terminal')).toBeNull()
    expect(fuzzyScore('xyz', 'New terminal')).toBe(-1)
  })
})

describe('recent picks', () => {
  const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
  it('moves recent items to the top, most recent first, and keeps the rest in order', () => {
    expect(withRecentFirst(items, ['c', 'a']).map((i) => i.id)).toEqual(['c', 'a', 'b', 'd'])
  })
  it('ignores recents that are not in the list', () => {
    expect(withRecentFirst(items, ['gone']).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('pushRecent puts the pick first, without duplicates, capped', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })
})
