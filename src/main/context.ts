import { createHash } from 'crypto'
import { existsSync, mkdirSync, promises as fsp } from 'fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'path'
import {
  CONTEXT_DIR,
  MAP_SKILL,
  MAP_SKILL_PATH,
  PINNED_FILE,
  PINNED_HEADER,
  SKILL_DIRS,
  ftsQuery,
  normalizePath,
  parseDoc,
  parseMemory,
  parsePinned,
  parseSkill,
  pathMatches,
  pinnedEntry,
  pinnedNode,
  rankHits,
  staleness,
  writtenAt,
  type ContextHit,
  type ContextKind,
  type ContextNode,
  type ContextStats
} from '@shared/context'
import { MEMORY_FILE } from '@shared/memory'
import { run } from './git'

/**
 * The project context index: one SQLite database per project in <userData>/context, rebuilt from the
 * Markdown sources whenever one of them changes (they're small, so a rebuild is a few milliseconds).
 * Nodes are notes and doc sections, `edges` link them to the files they mention, and an FTS5 table
 * answers topic searches. The repo holds the truth; this is a cache.
 */

const SCHEMA = 2
const MAX_DOCS = 200
const MAX_PINNED_BYTES = 256 * 1024

let baseDir = ''
const dbs = new Map<string, DatabaseSync>()

export function initContext(userData: string): void {
  baseDir = join(userData, 'context')
}

export function closeContext(): void {
  for (const db of dbs.values()) {
    try {
      db.close()
    } catch {
      // already closed
    }
  }
  dbs.clear()
}

function open(root: string): DatabaseSync {
  const cached = dbs.get(root)
  if (cached) return cached
  if (!baseDir) throw new Error('The context index is not ready')
  mkdirSync(baseDir, { recursive: true })
  const file = join(baseDir, `${createHash('sha1').update(root).digest('hex').slice(0, 16)}.db`)
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)')
  const v = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value: string } | undefined
  if (v?.value !== String(SCHEMA)) {
    db.exec(`
      DROP TABLE IF EXISTS nodes; DROP TABLE IF EXISTS edges; DROP TABLE IF EXISTS fts; DELETE FROM meta;
      CREATE TABLE nodes (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, line INTEGER NOT NULL,
        title TEXT NOT NULL, body TEXT NOT NULL, day TEXT, origin TEXT, source_time INTEGER);
      CREATE TABLE edges (node INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY (node, path));
      CREATE INDEX edges_path ON edges (path);
      CREATE VIRTUAL TABLE fts USING fts5(title, body, paths, tokenize = 'porter unicode61');
    `)
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?)").run(String(SCHEMA))
  }
  dbs.set(root, db)
  return db
}

// ── sources ──────────────────────────────────────────────────────

interface Source {
  rel: string
  /** pinned: a pinned file itself, read through the pinned list */
  kind: 'memory' | 'pins' | 'pinned' | 'doc' | 'skill'
  mtime: number
  size: number
}

async function stat(root: string, rel: string): Promise<{ mtime: number; size: number } | null> {
  const s = await fsp.stat(join(root, rel)).catch(() => null)
  return s?.isFile() ? { mtime: Math.floor(s.mtimeMs), size: s.size } : null
}

async function mdFiles(root: string, rel: string, depth = 3): Promise<string[]> {
  const entries = await fsp.readdir(join(root, rel), { withFileTypes: true }).catch(() => [])
  const out: string[] = []
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const child = `${rel}/${e.name}`
    if (e.isDirectory() && depth > 1) out.push(...(await mdFiles(root, child, depth - 1)))
    else if (e.isFile() && /\.mdx?$/i.test(e.name)) out.push(child)
  }
  return out
}

async function listSources(root: string): Promise<Source[]> {
  const want: Array<[string, Source['kind']]> = [[MEMORY_FILE, 'memory'], [PINNED_FILE, 'pins']]
  for (const f of (await mdFiles(root, CONTEXT_DIR)).slice(0, MAX_DOCS)) want.push([f, 'doc'])
  for (const dir of SKILL_DIRS) {
    const subs = await fsp.readdir(join(root, dir), { withFileTypes: true }).catch(() => [])
    for (const d of subs) if (d.isDirectory()) want.push([`${dir}/${d.name}/SKILL.md`, 'skill'])
  }
  const pinnedText = await fsp.readFile(join(root, PINNED_FILE), 'utf8').catch(() => '')
  for (const p of parsePinned(pinnedText)) want.push([p.path, 'pinned'])
  const sources: Source[] = []
  for (const [rel, kind] of want) {
    const s = await stat(root, rel)
    if (s) sources.push({ rel, kind, ...s })
  }
  return sources
}

const signature = (sources: Source[]): string => createHash('sha1').update(JSON.stringify(sources.map((s) => [s.rel, s.mtime, s.size]))).digest('hex')

async function read(root: string, rel: string): Promise<string | null> {
  return fsp.readFile(join(root, rel), 'utf8').catch(() => null)
}

/** Paths a note mentions that are real (or that the note listed itself, so a deleted file shows as gone). */
function keepPaths(root: string, n: ContextNode, listed: Set<string>): string[] {
  return n.paths.filter((p) => listed.has(p) || existsSync(join(root, p)))
}

async function collect(root: string, sources: Source[]): Promise<Array<ContextNode & { sourceTime?: number }>> {
  const nodes: Array<ContextNode & { sourceTime?: number }> = []
  const byRel = new Map(sources.map((s) => [s.rel, s]))
  for (const s of sources) {
    if (s.kind === 'pinned') continue
    const text = await read(root, s.rel)
    if (text === null) continue
    if (s.kind === 'memory') {
      for (const n of parseMemory(text, s.rel)) {
        const listed = new Set(/ · files: (.+)$/.exec(text.split(/\r?\n/)[n.line - 1] ?? '')?.[1].split(',').map((p) => normalizePath(p) ?? '') ?? [])
        nodes.push({ ...n, paths: keepPaths(root, n, listed) })
      }
    } else if (s.kind === 'pins') {
      for (const p of parsePinned(text)) {
        const file = byRel.get(p.path)
        const content = file && file.size <= MAX_PINNED_BYTES ? await read(root, p.path) : null
        for (const n of pinnedNode(p, content)) nodes.push({ ...n, paths: keepPaths(root, n, new Set([p.path])), sourceTime: file?.mtime })
      }
    } else if (s.kind === 'doc') {
      for (const n of parseDoc(text, s.rel)) nodes.push({ ...n, paths: keepPaths(root, n, new Set()), sourceTime: s.mtime })
    } else if (s.kind === 'skill') {
      const n = parseSkill(text, s.rel)
      nodes.push({ ...n, paths: keepPaths(root, n, new Set()), sourceTime: s.mtime })
    }
  }
  return nodes
}

const building = new Map<string, Promise<void>>()

/** Rebuilds the index when any source file changed since the last build. */
export async function ensureIndex(root: string, force = false): Promise<void> {
  const pending = building.get(root)
  if (pending) return pending
  const job = (async () => {
    const db = open(root)
    const sources = await listSources(root)
    const sig = signature(sources)
    const prev = db.prepare("SELECT value FROM meta WHERE key = 'sig'").get() as { value: string } | undefined
    if (!force && prev?.value === sig) return
    const nodes = await collect(root, sources)
    db.exec('BEGIN')
    try {
      db.exec('DELETE FROM nodes; DELETE FROM edges; DELETE FROM fts;')
      const insNode = db.prepare('INSERT INTO nodes (kind, source, line, title, body, day, origin, source_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      const insEdge = db.prepare('INSERT OR IGNORE INTO edges (node, path) VALUES (?, ?)')
      const insFts = db.prepare('INSERT INTO fts (rowid, title, body, paths) VALUES (?, ?, ?, ?)')
      for (const n of nodes) {
        const r = insNode.run(n.kind, n.source, n.line, n.title, n.body, n.day ?? null, n.origin ?? null, n.sourceTime ?? null)
        const id = Number(r.lastInsertRowid)
        for (const p of n.paths) insEdge.run(id, p)
        insFts.run(id, n.title, n.body, [...n.paths, n.source].map((p) => p.replace(/[/._-]+/g, ' ')).join(' '))
      }
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('sig', ?), ('at', ?)").run(sig, String(Date.now()))
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  })().finally(() => building.delete(root))
  building.set(root, job)
  return job
}

// ── reading ──────────────────────────────────────────────────────

interface Row {
  id: number
  kind: ContextKind
  source: string
  line: number
  title: string
  body: string
  day: string | null
  origin: string | null
  source_time: number | null
}

function edgesOf(db: DatabaseSync, ids: number[]): Map<number, string[]> {
  const out = new Map<number, string[]>()
  if (!ids.length) return out
  const rows = db.prepare(`SELECT node, path FROM edges WHERE node IN (${ids.map(() => '?').join(',')}) ORDER BY path`).all(...ids) as Array<{ node: number; path: string }>
  for (const r of rows) out.set(r.node, [...(out.get(r.node) ?? []), r.path])
  return out
}

/**
 * When each path last changed: its last commit in git (checkout times would make a fresh clone look
 * changed everywhere), else its mtime. A path that doesn't exist maps to undefined.
 */
async function changeTimes(root: string, paths: string[]): Promise<Map<string, number | undefined>> {
  const out = new Map<string, number | undefined>()
  if (!paths.length) return out
  const r = await run('git', ['log', '--format=%x00%ct', '--name-only', '--no-renames', '--', ...paths.slice(0, 200)], root, 10000)
  const committed = new Map<string, number>()
  if (r.code === 0) {
    let t = 0
    for (const raw of r.stdout.split('\n')) {
      const line = raw.trim()
      if (raw.startsWith('\u0000')) t = Number(raw.slice(1)) * 1000
      // newest first, so the first commit touching a path (or a file inside a folder path) is its last change
      else if (line) for (const p of paths) if (!committed.has(p) && (line === p || line.startsWith(`${p}/`))) committed.set(p, t)
    }
  }
  for (const p of paths) {
    const s = await fsp.stat(join(root, p)).catch(() => null)
    out.set(p, s ? (committed.get(p) ?? Math.floor(s.mtimeMs)) : undefined)
  }
  return out
}

async function toHits(root: string, db: DatabaseSync, scored: Array<{ id: number; score: number }>): Promise<ContextHit[]> {
  if (!scored.length) return []
  const ids = scored.map((s) => s.id)
  const rows = db.prepare(`SELECT * FROM nodes WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as unknown as Row[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  const edges = edgesOf(db, ids)
  const times = await changeTimes(root, [...new Set([...edges.values()].flat())])
  const hits: ContextHit[] = []
  for (const s of scored) {
    const r = byId.get(s.id)
    if (!r) continue
    const paths = edges.get(r.id) ?? []
    // a pinned file "changing" is the point of pinning it, and a doc section about its own file isn't stale
    const ignore = r.kind === 'file' ? r.source : undefined
    hits.push({
      id: r.id,
      score: s.score,
      kind: r.kind,
      source: r.source,
      line: r.line,
      title: r.title,
      body: r.body,
      day: r.day ?? undefined,
      origin: r.origin ?? undefined,
      paths,
      stale: r.kind === 'skill' ? undefined : staleness(paths, writtenAt({ day: r.day ?? undefined }, r.source_time ?? undefined), times, ignore)
    })
  }
  return hits
}

/** Nodes that are about a path (or a file inside it, or the folder it is in). */
function idsForPaths(db: DatabaseSync, paths: string[]): number[] {
  const ids = new Set<number>()
  const q = db.prepare("SELECT DISTINCT node FROM edges WHERE path = ? OR path LIKE ? ESCAPE '\\' OR ? LIKE (replace(replace(path, '%', '\\%'), '_', '\\_') || '/%') ESCAPE '\\'")
  const qs = db.prepare('SELECT id FROM nodes WHERE source = ?')
  const esc = (s: string): string => s.replace(/[%_\\]/g, (c) => `\\${c}`)
  for (const p of paths) {
    for (const r of q.all(p, `${esc(p)}/%`, p) as Array<{ node: number }>) ids.add(r.node)
    for (const r of qs.all(p) as Array<{ id: number }>) ids.add(r.id)
  }
  return [...ids]
}

function kindsOf(db: DatabaseSync, ids: number[]): Map<number, ContextKind> {
  if (!ids.length) return new Map()
  const rows = db.prepare(`SELECT id, kind FROM nodes WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Array<{ id: number; kind: ContextKind }>
  return new Map(rows.map((r) => [r.id, r.kind]))
}

/** Paths in `text` that the index has notes about (the brief names a file, a notes section links it). */
function knownPaths(db: DatabaseSync, root: string, text: string): string[] {
  const candidates = new Set<string>()
  for (const m of text.matchAll(/[\w@./\\-]+/g)) {
    const p = normalizePath(m[0].replace(/[.,;:]+$/, ''), root)
    if (p && (p.includes('/') || /\.[a-z0-9]{1,8}$/i.test(p))) candidates.add(p)
  }
  if (!candidates.size) return []
  const known = new Set((db.prepare('SELECT DISTINCT path FROM edges').all() as Array<{ path: string }>).map((r) => r.path))
  const sources = new Set((db.prepare('SELECT DISTINCT source FROM nodes').all() as Array<{ source: string }>).map((r) => r.source))
  return [...candidates].filter((c) => sources.has(c) || [...known].some((k) => pathMatches(k, c)))
}

/** The notes that best match a brief or a question: full text plus notes about the files it names. */
export async function search(root: string, text: string, limit = 6): Promise<ContextHit[]> {
  if (!root) return []
  await ensureIndex(root)
  const db = open(root)
  const q = ftsQuery(text)
  let fts: Array<{ id: number; bm25: number }> = []
  if (q) {
    try {
      fts = db.prepare('SELECT rowid AS id, bm25(fts, 3.0, 1.0, 2.0) AS bm25 FROM fts WHERE fts MATCH ? ORDER BY bm25 LIMIT 40').all(q) as Array<{ id: number; bm25: number }>
    } catch {
      fts = []
    }
  }
  const byPath = idsForPaths(db, knownPaths(db, root, text))
  const ids = [...new Set([...fts.map((f) => f.id), ...byPath])]
  return toHits(root, db, rankHits(fts, byPath, kindsOf(db, ids), limit))
}

/**
 * sldev_recall: by file (every note about it, and the other files those notes mention: one hop
 * through the graph) or by topic.
 */
export async function recall(root: string, o: { query?: string; path?: string }, limit = 10): Promise<{ hits: ContextHit[]; related: string[] }> {
  await ensureIndex(root)
  const db = open(root)
  const path = o.path ? normalizePath(o.path, root) : undefined
  if (path) {
    const ids = idsForPaths(db, [path])
    const scored = ids.map((id) => ({ id, score: 1 }))
    let hits = await toHits(root, db, scored)
    if (o.query?.trim()) {
      const topical = new Set((await search(root, o.query, 40)).map((h) => h.id))
      hits = [...hits.filter((h) => topical.has(h.id)), ...hits.filter((h) => !topical.has(h.id))]
    }
    hits = hits.slice(0, limit)
    const related = [...new Set(hits.flatMap((h) => h.paths))].filter((p) => !pathMatches(p, path))
    return { hits, related }
  }
  return { hits: await search(root, o.query ?? '', limit), related: [] }
}

/** Every node, for the Context view. */
export async function list(root: string): Promise<{ nodes: ContextHit[]; stats: ContextStats }> {
  await ensureIndex(root)
  const db = open(root)
  const rows = db.prepare('SELECT id FROM nodes ORDER BY kind, source, line').all() as Array<{ id: number }>
  const nodes = await toHits(root, db, rows.map((r) => ({ id: r.id, score: 0 })))
  const count = (k: ContextKind): number => nodes.filter((n) => n.kind === k && (k !== 'file' || n.line === 0)).length
  const at = db.prepare("SELECT value FROM meta WHERE key = 'at'").get() as { value: string } | undefined
  return { nodes: nodes.map((n) => ({ ...n, body: n.body.slice(0, 600) })), stats: { learnings: count('learning'), docs: count('doc'), files: count('file'), skills: count('skill'), indexedAt: Number(at?.value ?? 0) } }
}

// ── changing the sources ─────────────────────────────────────────

export async function pin(root: string, path: string, note?: string): Promise<string> {
  const rel = normalizePath(path, root)
  if (!rel) throw new Error('Only files inside the project can be pinned')
  if (!existsSync(join(root, rel))) throw new Error(`${rel} does not exist`)
  const file = join(root, PINNED_FILE)
  const text = await fsp.readFile(file, 'utf8').catch(() => null)
  if (text !== null && parsePinned(text).some((p) => p.path === rel)) return rel
  await fsp.mkdir(dirname(file), { recursive: true })
  const head = text === null ? `${PINNED_HEADER}\n` : text.endsWith('\n') ? text : `${text}\n`
  await fsp.writeFile(file, `${head}${pinnedEntry(rel, note)}\n`)
  return rel
}

export async function unpin(root: string, path: string): Promise<void> {
  const rel = normalizePath(path, root)
  const file = join(root, PINNED_FILE)
  const text = await fsp.readFile(file, 'utf8').catch(() => null)
  if (!rel || text === null) return
  const drop = new Set(parsePinned(text).filter((p) => p.path === rel).map((p) => p.line))
  await fsp.writeFile(file, text.split('\n').filter((_l, i) => !drop.has(i + 1)).join('\n'))
}

/** Writes the Map skill into the project (once), so any agent CLI can run it outside sldev too. */
export async function installMapSkill(root: string): Promise<string> {
  const file = join(root, ...MAP_SKILL_PATH.split('/'))
  await fsp.mkdir(dirname(file), { recursive: true })
  await fsp.writeFile(file, MAP_SKILL, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== 'EEXIST') throw e
  })
  return file
}
