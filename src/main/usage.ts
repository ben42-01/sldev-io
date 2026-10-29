import { homedir } from 'os'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { StringDecoder } from 'string_decoder'
import { claudeTranscriptReader, codexSessionReader, type LineReader, type TokenUsage } from '@shared/usage'

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

interface Tail {
  reader: LineReader<unknown>
  offset: number
  decoder: StringDecoder
  /** an unfinished last line, completed by the next read */
  partial: string
}

const tails = new Map<string, Tail>()
/** one read per log at a time, so two panels polling together never feed a line twice */
const reading = new Map<string, Promise<unknown>>()
const CHUNK = 4 * 1024 * 1024

/**
 * A log's parsed result, reading only what was appended since the last call. Agent logs grow to
 * hundreds of MB and are polled while missions run; parsing them whole on every poll froze the app.
 */
function tailed<T>(path: string, make: () => LineReader<T>): Promise<T | null> {
  const next = (reading.get(path) ?? Promise.resolve()).then(() => readTail(path, make))
  reading.set(path, next)
  void next.finally(() => reading.get(path) === next && reading.delete(path))
  return next
}

async function readTail<T>(path: string, make: () => LineReader<T>): Promise<T | null> {
  let fh: fsp.FileHandle | undefined
  try {
    fh = await fsp.open(path, 'r')
    const { size } = await fh.stat()
    let t = tails.get(path)
    // a log that shrank was rewritten: start over
    if (!t || size < t.offset) tails.set(path, (t = { reader: make(), offset: 0, decoder: new StringDecoder('utf8'), partial: '' }))
    const buf = Buffer.alloc(Math.min(CHUNK, Math.max(0, size - t.offset)))
    while (t.offset < size) {
      const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, size - t.offset), t.offset)
      if (!bytesRead) break
      t.offset += bytesRead
      const lines = (t.partial + t.decoder.write(buf.subarray(0, bytesRead))).split('\n')
      t.partial = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) t.reader.line(line)
      // let IPC and pty output through between chunks
      await new Promise((r) => setImmediate(r))
    }
    return t.reader.result() as T
  } catch {
    return null
  } finally {
    await fh?.close()
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
    const s = await tailed(f, codexSessionReader)
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
    if (r.agent === 'claude' && r.transcriptPath) out[r.id] = await tailed(r.transcriptPath, claudeTranscriptReader)
    else if (r.agent === 'codex') out[r.id] = await codexUsage(r)
    else out[r.id] = null
  }
  return out
}
