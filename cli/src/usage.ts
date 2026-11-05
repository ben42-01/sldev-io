import { createReadStream, promises as fsp } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { addTokens, claudeTranscriptReader, codexSessionReader, NO_TOKENS, tokenTotal, type TokenUsage } from '@shared/usage'
import { PRICES_CHECKED } from '@shared/prices'

/**
 * `sldev usage`: tokens and estimated cost per agent from the logs the agents keep on this machine
 * (Claude Code transcripts, Codex sessions). Nothing is sent anywhere. Logs not written to since the
 * start of the period are skipped without being opened; the rest are streamed line by line.
 */

export interface UsageRow {
  agent: string
  sessions: number
  usage: TokenUsage
}

const TIMESTAMP = /"timestamp"\s*:\s*"([^"]+)"/

async function streamLines(path: string, each: (line: string) => void): Promise<void> {
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of rl) if (line.trim()) each(line)
}

async function jsonlFiles(dir: string, depth: number, since: number): Promise<string[]> {
  const out: string[] = []
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name)
    if (e.isDirectory() && depth > 0) out.push(...(await jsonlFiles(p, depth - 1, since)))
    else if (e.isFile() && e.name.endsWith('.jsonl')) {
      const st = await fsp.stat(p).catch(() => null)
      if (st && st.mtimeMs >= since) out.push(p)
    }
  }
  return out
}

/** Claude Code: only the messages written in the period count, so a session that spans days is split. */
export async function claudeUsage(since: number, env: NodeJS.ProcessEnv = process.env): Promise<UsageRow> {
  const dir = join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
  let total = NO_TOKENS
  let sessions = 0
  for (const f of await jsonlFiles(dir, 1, since)) {
    const reader = claudeTranscriptReader()
    await streamLines(f, (line) => {
      const t = Date.parse(TIMESTAMP.exec(line)?.[1] ?? '')
      if (!Number.isNaN(t) && t >= since) reader.line(line)
    })
    const u = reader.result()
    if (u) {
      total = addTokens(total, u)
      sessions++
    }
  }
  return { agent: 'Claude Code', sessions, usage: total }
}

/** Codex logs a running total per session, so a session counts whole when it started in the period. */
export async function codexUsage(since: number, env: NodeJS.ProcessEnv = process.env): Promise<UsageRow> {
  const dir = join(env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
  let total = NO_TOKENS
  let sessions = 0
  for (const f of await jsonlFiles(dir, 3, since)) {
    const reader = codexSessionReader()
    await streamLines(f, (line) => reader.line(line))
    const s = reader.result()
    if (s.usage && (s.startedAt ?? 0) >= since) {
      total = addTokens(total, s.usage)
      sessions++
    }
  }
  return { agent: 'Codex', sessions, usage: total }
}

/** Midnight today, or the Monday of this week, in local time. */
export function periodStart(week: boolean, now = new Date()): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (week) d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

const n = (x: number): string => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}k` : String(x))

export function usageTable(rows: UsageRow[], label: string): string {
  const head = ['Agent', 'Sessions', 'Input', 'Output', 'Cache read', 'Cache write', 'Est. cost']
  const body = rows.map((r) => [r.agent, String(r.sessions), n(r.usage.input), n(r.usage.output), n(r.usage.cacheRead), n(r.usage.cacheWrite), `$${r.usage.cost.toFixed(2)}`])
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)))
  const line = (cells: string[]): string => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ')
  const unpriced = rows.reduce((a, r) => a + r.usage.unpriced, 0)
  const total = rows.reduce((a, r) => a + tokenTotal(r.usage), 0)
  return [
    `Token usage ${label}, from the agents' local logs`,
    '',
    line(head),
    ...body.map(line),
    '',
    `${n(total)} tokens. Cost is an estimate at API list prices (checked ${PRICES_CHECKED}); a subscription bills differently.`,
    ...(unpriced ? [`${n(unpriced)} tokens are from models without a known price and aren't in the cost.`] : [])
  ].join('\n')
}
