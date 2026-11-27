/**
 * What main was doing before a stall: the last IPC calls it answered and the ptys it spawned, with how long each
 * took and how big a large result was. Only channel names, program names, durations and sizes are kept, never
 * arguments, prompts, paths or output.
 */

export interface TrailEntry {
  /** when it started (ms since the epoch) */
  at: number
  /** a channel (`gh:prReview`) or a spawn (`pty:spawn copilot`) */
  what: string
  ms: number
  bytes?: number
}

/** a result smaller than this isn't worth a size */
export const BIG_RESULT = 64 * 1024

export class Trail {
  private entries: TrailEntry[] = []
  private running = new Map<number, { at: number; what: string }>()
  private nextId = 1
  /** entries before this were written under an earlier stall */
  private taken = 0

  constructor(private readonly max = 20) {}

  /** a call starts; the id ends it */
  start(what: string, at = Date.now()): number {
    const id = this.nextId++
    this.running.set(id, { at, what })
    return id
  }

  end(id: number, bytes?: number, now = Date.now()): void {
    const r = this.running.get(id)
    if (!r) return
    this.running.delete(id)
    this.add({ at: r.at, what: r.what, ms: now - r.at, ...(bytes !== undefined && bytes >= BIG_RESULT ? { bytes } : {}) })
  }

  add(e: TrailEntry): void {
    this.entries.push(e)
    if (this.entries.length > this.max) this.entries.shift()
  }

  /** The lines that go under a stall: what finished since the last stall, then what is still running; each written once. */
  take(now = Date.now()): string[] {
    const done = this.entries.filter((e) => e.at + e.ms >= this.taken).map((e) => trailLine(e))
    const live = [...this.running.values()].slice(-this.max).map((r) => `${clock(r.at)} ${r.what} still running after ${seconds(now - r.at)}`)
    this.taken = now
    return [...done, ...live]
  }
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
const clock = (t: number): string => {
  const d = new Date(t)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}
const seconds = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${Math.round(n / 1024)} KB`
}

/** `12:00:01.234 gh:prReview 41 MB 2.3 s` */
export const trailLine = (e: TrailEntry): string => `${clock(e.at)} ${e.what}${e.bytes !== undefined ? ` ${formatBytes(e.bytes)}` : ''} ${seconds(e.ms)}`

/**
 * About how many bytes a result crosses IPC as, without serialising it: strings and buffers, two levels into
 * objects and arrays, and at most a few thousand values looked at (a long list is counted by what was seen).
 */
export function sizeOf(v: unknown, depth = 0, budget = { left: 5000 }): number {
  if (budget.left-- <= 0) return 0
  if (typeof v === 'string') return v.length
  if (v instanceof ArrayBuffer) return v.byteLength
  if (ArrayBuffer.isView(v)) return v.byteLength
  if (!v || typeof v !== 'object' || depth > 2) return 0
  let n = 0
  for (const x of Array.isArray(v) ? v : Object.values(v)) {
    n += sizeOf(x, depth + 1, budget)
    if (budget.left <= 0) break
  }
  return n
}

/** The program a pty runs, by name only (`copilot`, `shell`): never its path or arguments. */
export function spawnName(command: string | string[] | undefined): string {
  if (!Array.isArray(command) || !command[0]) return 'shell'
  return command[0].split(/[\\/]/).pop()!.replace(/\.(exe|cmd|bat|ps1)$/i, '') || 'shell'
}
