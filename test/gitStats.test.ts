import { describe, expect, it } from 'vitest'
import { addDays, bucketCommits, bucketKeys, bucketLabel, bucketPrs, bucketUnit, dayKey, niceMax, parseCommitLog, prSearch, rangeFrom, sinceArg, weekKey } from '@shared/gitStats'
import type { ActivityCommit } from '@shared/types'

const NOW = Date.parse('2026-11-13T15:00:00Z') // a Friday
const c = (date: string, merge = false, author = 'Ana'): ActivityCommit => ({ date, merge, author })

describe('days and weeks', () => {
  it('takes the calendar day in the given time zone', () => {
    const t = Date.parse('2026-11-13T23:30:00Z')
    expect(dayKey(t, 'UTC')).toBe('2026-11-13')
    expect(dayKey(t, 'Asia/Tokyo')).toBe('2026-11-14')
    expect(dayKey(Date.parse('2026-11-13T03:00:00Z'), 'America/Los_Angeles')).toBe('2026-11-12')
  })

  it('steps over month ends and DST changes by calendar day', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    // Europe went back an hour on 2026-10-25: still one day per step
    expect(bucketKeys(7, Date.parse('2026-10-27T12:00:00Z'), 'Europe/Berlin')).toEqual(['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'])
  })

  it('starts weeks on Monday', () => {
    expect(weekKey('2026-11-13')).toBe('2026-11-09')
    expect(weekKey('2026-11-09')).toBe('2026-11-09')
    expect(weekKey('2026-11-15')).toBe('2026-11-09')
  })

  it('uses days up to a month and weeks for 90 days', () => {
    expect(bucketUnit(7)).toBe('day')
    expect(bucketUnit(30)).toBe('day')
    expect(bucketUnit(90)).toBe('week')
    expect(bucketKeys(30, NOW, 'UTC')).toHaveLength(30)
    const weeks = bucketKeys(90, NOW, 'UTC')
    expect(weeks[0]).toBe(weekKey(rangeFrom(90, NOW, 'UTC')))
    expect(weeks.at(-1)).toBe('2026-11-09')
    expect(weeks).toHaveLength(14)
  })

  it('gives git and gh the start of the range', () => {
    expect(rangeFrom(7, NOW, 'UTC')).toBe('2026-11-07')
    expect(sinceArg('2026-11-07')).toBe('2026-11-07 00:00:00')
    expect(prSearch('2026-11-07')).toBe('updated:>=2026-11-06')
  })

  it('labels days and weeks', () => {
    expect(bucketLabel('2026-11-03', 'day')).toBe('Nov 3')
    expect(bucketLabel('2026-11-09', 'week')).toBe('Week of Nov 9')
  })
})

describe('parseCommitLog', () => {
  it('reads date, merge and author', () => {
    const out = '2026-11-13T10:00:00+01:00\x1fabc\x1fAna\n2026-11-12T09:00:00Z\x1fabc def\x1fBo Li\n\n2026-11-12T08:00:00Z\x1f\x1fRoot\n'
    expect(parseCommitLog(out)).toEqual([
      { date: '2026-11-13T10:00:00+01:00', merge: false, author: 'Ana' },
      { date: '2026-11-12T09:00:00Z', merge: true, author: 'Bo Li' },
      { date: '2026-11-12T08:00:00Z', merge: false, author: 'Root' }
    ])
  })
  it('is empty for no output', () => expect(parseCommitLog('')).toEqual([]))
})

describe('bucketCommits', () => {
  it('counts per day with merges apart, empty days kept', () => {
    const a = bucketCommits([c('2026-11-13T10:00:00Z'), c('2026-11-13T11:00:00Z', true, 'Bo'), c('2026-11-10T10:00:00Z')], 7, NOW, 'UTC')
    expect(a.unit).toBe('day')
    expect(a.buckets.map((b) => b.key)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'])
    expect(a.buckets.map((b) => b.commits)).toEqual([0, 0, 0, 1, 0, 0, 2])
    expect(a.buckets.map((b) => b.merges)).toEqual([0, 0, 0, 0, 0, 0, 1])
    expect(a).toMatchObject({ total: 3, merges: 1, authors: [{ name: 'Ana', commits: 2 }, { name: 'Bo', commits: 1 }] })
  })

  it("puts a commit on its day in the viewer's time zone, not its own offset", () => {
    // 00:30 in Berlin on the 13th is still the 12th in UTC and in New York
    const commit = [c('2026-11-13T00:30:00+01:00')]
    expect(bucketCommits(commit, 7, NOW, 'Europe/Berlin').buckets.at(-1)!.commits).toBe(1)
    expect(bucketCommits(commit, 7, NOW, 'UTC').buckets.at(-2)!.commits).toBe(1)
    expect(bucketCommits(commit, 7, NOW, 'America/New_York').buckets.at(-2)!.commits).toBe(1)
  })

  it('drops commits before the range and keeps ones dated in the future in today, like git log --since', () => {
    const a = bucketCommits([c('2026-11-06T23:59:00Z'), c('2026-11-07T00:00:00Z'), c('2026-11-20T00:00:00Z')], 7, NOW, 'UTC')
    expect(a.total).toBe(2)
    expect(a.buckets[0].commits).toBe(1)
    expect(a.buckets.at(-1)!.commits).toBe(1)
  })

  it('ignores unreadable dates', () => expect(bucketCommits([c('not a date')], 7, NOW, 'UTC').total).toBe(0))

  it('counts per week for 90 days, the first week partly in range', () => {
    const from = rangeFrom(90, NOW, 'UTC') // 2026-08-16, a Sunday
    expect(from).toBe('2026-08-16')
    const a = bucketCommits([c('2026-08-15T12:00:00Z'), c('2026-08-16T12:00:00Z'), c('2026-11-09T00:00:00Z'), c('2026-11-13T09:00:00Z', true)], 90, NOW, 'UTC')
    expect(a.unit).toBe('week')
    expect(a.buckets[0]).toMatchObject({ key: '2026-08-10', commits: 1 })
    expect(a.buckets.at(-1)).toMatchObject({ key: '2026-11-09', commits: 2, merges: 1 })
    expect(a.total).toBe(3)
  })

  it('has every bucket and no authors when nothing happened', () => {
    const a = bucketCommits([], 30, NOW, 'UTC')
    expect(a.buckets).toHaveLength(30)
    expect(a.buckets.every((b) => b.commits === 0)).toBe(true)
    expect(a).toMatchObject({ total: 0, merges: 0, authors: [] })
  })
})

describe('bucketPrs', () => {
  it('counts opened and merged on their own days, closed-unmerged apart', () => {
    const a = bucketPrs(
      [
        { number: 1, createdAt: '2026-11-01T10:00:00Z', mergedAt: '2026-11-12T10:00:00Z', closedAt: '2026-11-12T10:00:00Z' },
        { number: 2, createdAt: '2026-11-12T10:00:00Z', mergedAt: null, closedAt: null },
        { number: 3, createdAt: '2026-11-13T10:00:00Z', mergedAt: '2026-11-13T12:00:00Z', closedAt: '2026-11-13T12:00:00Z' },
        { number: 4, createdAt: '2026-11-10T10:00:00Z', mergedAt: null, closedAt: '2026-11-11T10:00:00Z' },
        { number: 5, createdAt: '2026-10-01T10:00:00Z', mergedAt: null, closedAt: '2026-10-02T10:00:00Z' }
      ],
      7,
      NOW,
      'UTC'
    )
    expect(a.buckets.map((b) => b.opened)).toEqual([0, 0, 0, 1, 0, 1, 1])
    expect(a.buckets.map((b) => b.merged)).toEqual([0, 0, 0, 0, 0, 1, 1])
    expect(a).toMatchObject({ opened: 3, merged: 2, closed: 1 })
  })
})

describe('niceMax', () => {
  it('rounds the axis up to 1, 2 or 5 × 10ⁿ', () => {
    expect([0, 1, 2, 3, 7, 10, 11, 48, 120].map(niceMax)).toEqual([1, 1, 2, 5, 10, 10, 20, 50, 200])
  })
})
