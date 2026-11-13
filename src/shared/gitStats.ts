import type { ActivityCommit, ActivityPr } from './types'

/**
 * The stats panel's activity charts: commits (merges apart) and pull requests opened vs merged, counted per
 * local day, or per week for the long range. Days are calendar days in a time zone (the machine's by default),
 * so a commit at 23:30 counts on the day it was made there, whatever offset its own date carries.
 */

export const ACTIVITY_RANGES = [7, 30, 90] as const
export type ActivityDays = (typeof ACTIVITY_RANGES)[number]

/** `git log --format`: committer date, parents, author name, unit-separated. */
export const COMMIT_LOG_FORMAT = '%cI%x1f%P%x1f%an'

export type BucketUnit = 'day' | 'week'

export interface CommitBucket {
  /** YYYY-MM-DD: the day, or the Monday that starts the week */
  key: string
  label: string
  commits: number
  merges: number
}

export interface CommitActivity {
  unit: BucketUnit
  buckets: CommitBucket[]
  total: number
  merges: number
  /** most commits first */
  authors: { name: string; commits: number }[]
}

export interface PrBucket {
  key: string
  label: string
  opened: number
  merged: number
}

export interface PrActivity {
  unit: BucketUnit
  buckets: PrBucket[]
  opened: number
  merged: number
  /** closed without being merged */
  closed: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const formatters = new Map<string, Intl.DateTimeFormat>()

/** The calendar day (YYYY-MM-DD) of instant `t` in `tz` (an IANA zone; the machine's when left out). */
export function dayKey(t: number, tz?: string): string {
  let f = formatters.get(tz ?? '')
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    formatters.set(tz ?? '', f)
  }
  const parts = Object.fromEntries(f.formatToParts(t).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

// calendar arithmetic on keys happens in UTC, where every day is 24 h long (no DST)
const keyMs = (key: string): number => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10))
const msKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export const addDays = (key: string, n: number): string => msKey(keyMs(key) + n * 86_400_000)

/** The Monday on or before day `key`. */
export function weekKey(key: string): string {
  const dow = (new Date(keyMs(key)).getUTCDay() + 6) % 7 // Monday = 0
  return addDays(key, -dow)
}

/** Days for the short ranges; weeks for 90 days, where 90 bars would be too thin to read. */
export const bucketUnit = (days: number): BucketUnit => (days > 31 ? 'week' : 'day')

/** The first day of the last `days` days, today included. */
export const rangeFrom = (days: number, now: number, tz?: string): string => addDays(dayKey(now, tz), -(days - 1))

/** What `git log --since` gets for the range: midnight of its first day, in git's (local) time. */
export const sinceArg = (from: string): string => `${from} 00:00:00`

export function bucketLabel(key: string, unit: BucketUnit): string {
  const label = `${MONTHS[+key.slice(5, 7) - 1]} ${+key.slice(8, 10)}`
  return unit === 'week' ? `Week of ${label}` : label
}

/** Every bucket of the range in order, empty ones included. */
export function bucketKeys(days: number, now: number, tz?: string): string[] {
  const unit = bucketUnit(days)
  const today = dayKey(now, tz)
  const keys: string[] = []
  if (unit === 'day') {
    for (let k = rangeFrom(days, now, tz); k <= today; k = addDays(k, 1)) keys.push(k)
  } else {
    for (let k = weekKey(rangeFrom(days, now, tz)); k <= today; k = addDays(k, 7)) keys.push(k)
  }
  return keys
}

/**
 * The bucket an instant falls in, or null when it's before the range. A date after today (a clock that runs
 * ahead) goes in the last bucket: `git log --since` lists it too, and the totals should match git's.
 */
function bucketIndex(iso: string, r: Range): number | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const day = dayKey(t, r.tz)
  // the first week starts before the range: a day before it doesn't count, though its week is shown
  if (day < r.from) return null
  const { keys } = r
  const key = r.unit === 'week' ? weekKey(day) : day
  const i = keys.indexOf(key)
  return i >= 0 ? i : keys.length - 1
}

interface Range {
  unit: BucketUnit
  keys: string[]
  from: string
  tz?: string
}

const range = (days: number, now: number, tz?: string): Range => ({ unit: bucketUnit(days), keys: bucketKeys(days, now, tz), from: rangeFrom(days, now, tz), tz })

/** Lines of `git log --format=COMMIT_LOG_FORMAT`. */
export function parseCommitLog(out: string): ActivityCommit[] {
  const commits: ActivityCommit[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [date, parents = '', author = ''] = line.split('\x1f')
    commits.push({ date, merge: parents.trim().split(/\s+/).filter(Boolean).length > 1, author: author.trim() })
  }
  return commits
}

export function bucketCommits(commits: ActivityCommit[], days: number, now: number, tz?: string): CommitActivity {
  const r = range(days, now, tz)
  const { unit, keys } = r
  const buckets = keys.map((key) => ({ key, label: bucketLabel(key, unit), commits: 0, merges: 0 }))
  const authors = new Map<string, number>()
  let total = 0
  let merges = 0
  for (const c of commits) {
    const i = bucketIndex(c.date, r)
    if (i === null) continue
    buckets[i].commits++
    total++
    if (c.merge) {
      buckets[i].merges++
      merges++
    }
    const name = c.author || 'unknown'
    authors.set(name, (authors.get(name) ?? 0) + 1)
  }
  return {
    unit,
    buckets,
    total,
    merges,
    authors: [...authors].map(([name, n]) => ({ name, commits: n })).sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
  }
}

/** PRs opened in each bucket and PRs merged in each bucket (a PR opened before the range can be merged in it). */
export function bucketPrs(prs: ActivityPr[], days: number, now: number, tz?: string): PrActivity {
  const r = range(days, now, tz)
  const { unit, keys } = r
  const buckets = keys.map((key) => ({ key, label: bucketLabel(key, unit), opened: 0, merged: 0 }))
  let opened = 0
  let merged = 0
  let closed = 0
  for (const p of prs) {
    const o = bucketIndex(p.createdAt, r)
    if (o !== null) {
      buckets[o].opened++
      opened++
    }
    if (p.mergedAt) {
      const m = bucketIndex(p.mergedAt, r)
      if (m !== null) {
        buckets[m].merged++
        merged++
      }
    } else if (p.closedAt && bucketIndex(p.closedAt, r) !== null) closed++
  }
  return { unit, buckets, opened, merged, closed }
}

/** The `--search` for `gh pr list`: PRs touched since the day before the range (GitHub's dates are UTC). */
export const prSearch = (from: string): string => `updated:>=${addDays(from, -1)}`

/** A round axis maximum (1, 2, 5 × 10ⁿ) at or above `n`, never below 1. */
export function niceMax(n: number): number {
  if (n <= 1) return 1
  const p = 10 ** Math.floor(Math.log10(n))
  for (const m of [1, 2, 5, 10]) if (m * p >= n) return m * p
  return 10 * p
}
