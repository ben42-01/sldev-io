import type { Mission, MissionStatus } from './types'

/** Usage dashboard math: everything here comes from mission status history and local agent logs. */

export interface Segment {
  status: MissionStatus
  from: number
  to: number
}

const LIVE: MissionStatus[] = ['starting', 'working', 'waiting', 'needs-input']

/** The mission's life as status spans; a live mission's last span runs until `now`. */
export function segments(m: Mission, now: number): Segment[] {
  const h = m.history?.length ? m.history : [{ status: m.status, at: m.createdAt }]
  const out: Segment[] = []
  for (let i = 0; i < h.length; i++) {
    const { status, at } = h[i]
    if (!LIVE.includes(status)) continue
    const to = h[i + 1]?.at ?? (LIVE.includes(m.status) ? now : m.updatedAt)
    if (to > at) out.push({ status, from: at, to })
  }
  return out
}

export function clipSegments(segs: Segment[], start: number, end: number): Segment[] {
  return segs.filter((s) => s.to > start && s.from < end).map((s) => ({ ...s, from: Math.max(s.from, start), to: Math.min(s.to, end) }))
}

/** Total time missions spent in a status within [start, end]. */
export function timeIn(missions: Mission[], status: MissionStatus, start: number, end: number, now: number): number {
  let t = 0
  for (const m of missions) for (const s of clipSegments(segments(m, now), start, end)) if (s.status === status) t += s.to - s.from
  return t
}

/** How long each "needs you" lasted until someone answered (closed spans only). */
export function responseTimes(missions: Mission[], start: number, end: number, now: number): number[] {
  return missions.flatMap((m) =>
    segments(m, now)
      .filter((s, i, all) => s.status === 'needs-input' && s.from >= start && s.from < end && (i < all.length - 1 || !LIVE.includes(m.status)))
      .map((s) => s.to - s.from)
  )
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Did the mission do anything inside [start, end]? */
export const activeIn = (m: Mission, start: number, end: number, now: number): boolean => clipSegments(segments(m, now), start, end).length > 0

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export const tokenTotal = (u: TokenUsage): number => u.input + u.output + u.cacheRead + u.cacheWrite

export function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite }
}

export const NO_TOKENS: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/**
 * Claude Code transcript (JSONL): each assistant message carries `usage`. A message can span several
 * lines with the same id, so the last line per id counts.
 */
export function claudeTranscriptUsage(jsonl: string): TokenUsage | null {
  const byId = new Map<string, TokenUsage>()
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"usage"')) continue
    try {
      const d = JSON.parse(line) as { type?: string; message?: { id?: string; usage?: Record<string, number> } }
      const u = d.type === 'assistant' ? d.message?.usage : undefined
      if (!u) continue
      byId.set(d.message?.id ?? String(byId.size), {
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0
      })
    } catch {
      // a partly written line
    }
  }
  return byId.size ? [...byId.values()].reduce(addTokens, NO_TOKENS) : null
}

/**
 * Codex session log (JSONL): a session_meta line with the cwd and start time, then token_count events
 * whose `total_token_usage` is the running total.
 */
export function codexSessionUsage(jsonl: string): { cwd?: string; startedAt?: number; usage: TokenUsage | null } {
  let cwd: string | undefined
  let startedAt: number | undefined
  let usage: TokenUsage | null = null
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    try {
      const d = JSON.parse(line) as { type?: string; timestamp?: string; payload?: Record<string, unknown> }
      const p = d.payload ?? {}
      if (d.type === 'session_meta') {
        cwd = typeof p.cwd === 'string' ? p.cwd : cwd
        const t = Date.parse(String(p.timestamp ?? d.timestamp ?? ''))
        if (!Number.isNaN(t)) startedAt = t
      }
      const total = p.type === 'token_count' ? ((p.info as Record<string, unknown> | undefined)?.total_token_usage as Record<string, number> | undefined) : undefined
      if (total) {
        const cached = total.cached_input_tokens ?? 0
        usage = { input: Math.max(0, (total.input_tokens ?? 0) - cached), output: (total.output_tokens ?? 0) + (total.reasoning_output_tokens ?? 0), cacheRead: cached, cacheWrite: 0 }
      }
    } catch {
      // a partly written line
    }
  }
  return { cwd, startedAt, usage }
}

/** Evenly spaced time ticks at a readable step (minutes, hours or days). */
export function timeTicks(start: number, end: number, max = 6): number[] {
  const steps = [5, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080].map((m) => m * 60000)
  const step = steps.find((s) => (end - start) / s <= max) ?? steps[steps.length - 1]
  const out: number[] = []
  const tz = new Date(start).getTimezoneOffset() * 60000
  for (let t = Math.ceil((start - tz) / step) * step + tz; t <= end; t += step) out.push(t)
  return out
}
