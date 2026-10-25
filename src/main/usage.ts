import { homedir } from 'os'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { claudeTranscriptUsage, codexSessionUsage, type TokenUsage } from '@shared/usage'

/**
 * Token usage from the logs agents already keep on this machine. Nothing is sent anywhere.
 * Claude Code: the transcript its hooks point at. Codex: its session logs (CODEX_HOME, default ~/.codex).
 */

export interface UsageRequest {
  id: string
  agent: string
  cwd: string
  from: number
  to: number
  transcriptPath?: string
}

const cache = new Map<string, { mtime: number; value: unknown }>()

async function cached<T>(path: string, read: (text: string) => T): Promise<T | null> {
  try {
    const st = await fsp.stat(path)
    const hit = cache.get(path)
    if (hit && hit.mtime === st.mtimeMs) return hit.value as T
    const value = read(await fsp.readFile(path, 'utf8'))
    cache.set(path, { mtime: st.mtimeMs, value })
    return value
  } catch {
    return null
  }
}

const codexHome = (): string => process.env.CODEX_HOME || join(homedir(), '.codex')

/** Session files for the days a mission ran: sessions/YYYY/MM/DD/*.jsonl */
async function codexFiles(from: number, to: number): Promise<string[]> {
  const files: string[] = []
  for (let t = from - 86400000; t <= to + 86400000; t += 86400000) {
    const d = new Date(t)
    const dir = join(codexHome(), 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
    for (const f of await fsp.readdir(dir).catch(() => [] as string[])) if (f.endsWith('.jsonl')) files.push(join(dir, f))
  }
  return [...new Set(files)]
}

/** The Codex session that started in this mission's folder closest after the mission did. */
async function codexUsage(r: UsageRequest): Promise<TokenUsage | null> {
  let best: { gap: number; usage: TokenUsage | null } | null = null
  for (const f of await codexFiles(r.from, r.to)) {
    const s = await cached(f, codexSessionUsage)
    if (!s || s.cwd !== r.cwd || s.startedAt === undefined) continue
    const gap = s.startedAt - r.from
    if (gap < -60000 || s.startedAt > r.to + 60000) continue
    if (!best || Math.abs(gap) < Math.abs(best.gap)) best = { gap, usage: s.usage }
  }
  return best?.usage ?? null
}

export async function missionTokens(reqs: UsageRequest[]): Promise<Record<string, TokenUsage | null>> {
  const out: Record<string, TokenUsage | null> = {}
  for (const r of reqs.slice(0, 500)) {
    if (r.agent === 'claude' && r.transcriptPath) out[r.id] = await cached(r.transcriptPath, claudeTranscriptUsage)
    else if (r.agent === 'codex') out[r.id] = await codexUsage(r)
    else out[r.id] = null
  }
  return out
}
