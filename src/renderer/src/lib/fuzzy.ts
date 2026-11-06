/** Subsequence fuzzy match. Returns a score (higher is better) or -1. */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let ti = 0
  let score = 0
  let streak = 0
  for (const ch of q) {
    if (ch === ' ') continue
    const found = t.indexOf(ch, ti)
    if (found < 0) return -1
    streak = found === ti ? streak + 1 : 0
    score += 1 + streak * 2 + (found === 0 || /[\s/:._-]/.test(t[found - 1]) ? 3 : 0)
    ti = found + 1
  }
  return score - t.length * 0.01
}

/**
 * The positions in `text` to highlight for `query`: the query as one run when the text contains it (spaces ignored),
 * otherwise the letters fuzzyScore's greedy walk matched; null when it doesn't match at all.
 */
export function fuzzyMatches(query: string, text: string): number[] | null {
  const t = text.toLowerCase()
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return []
  const at = t.indexOf(q)
  if (at >= 0) return Array.from(q, (_, i) => at + i)
  const hits: number[] = []
  let ti = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    hits.push(found)
    ti = found + 1
  }
  return hits
}

/** Items the user picked recently (most recent first) move to the top, in that order; the rest keep theirs. */
export function withRecentFirst<T extends { id: string }>(items: T[], recent: string[]): T[] {
  if (!recent.length) return items
  const rank = new Map(recent.map((id, i) => [id, i]))
  const top = items.filter((it) => rank.has(it.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  return top.length ? [...top, ...items.filter((it) => !rank.has(it.id))] : items
}

/** `id` becomes the most recent, the list stays at most `max` long. */
export function pushRecent(recent: string[], id: string, max = 8): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, max)
}
