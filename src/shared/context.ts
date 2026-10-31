/**
 * Project context: what agents should know about a project, found by topic or by file. The truth is
 * Markdown in the repo (committable, reviewable): `.sldev/memory.md` (learnings), `.sldev/context/*.md`
 * (reference docs, e.g. from a "Map project" mission), `.sldev/pinned.md` (files the user pinned) and
 * project skills. The main process indexes them into a local SQLite database (full-text search plus
 * edges from each note to the files it mentions); deleting the index loses nothing.
 *
 * Everything here is pure, so parsing, ranking, staleness and the prompt text are unit-tested.
 */

export const CONTEXT_DIR = '.sldev/context'
export const PINNED_FILE = '.sldev/pinned.md'
export const SKILL_DIRS = ['.claude/skills', '.sldev/skills', '.agents/skills']

export type ContextKind = 'learning' | 'doc' | 'file' | 'skill'

export interface ContextNode {
  kind: ContextKind
  /** repo-relative, forward slashes */
  source: string
  /** 1-based line where the note starts; 0 for a pinned file as a whole */
  line: number
  title: string
  body: string
  /** learnings: the day it was recorded (YYYY-MM-DD) */
  day?: string
  /** who recorded it: an agent and mission, or "you" */
  origin?: string
  /** repo-relative files and folders the note is about */
  paths: string[]
}

export interface ContextStale {
  path: string
  why: 'changed' | 'missing'
}

export interface ContextHit extends ContextNode {
  id: number
  score: number
  /** a file the note is about changed (or went away) after the note was written */
  stale?: ContextStale
}

export interface ContextStats {
  learnings: number
  docs: number
  files: number
  skills: number
  /** when the index was last rebuilt from the files */
  indexedAt: number
}

// ── paths ────────────────────────────────────────────────────────

const EXT = /\.[a-z0-9]{1,8}$/i
const CODE = /`([^`\n]{2,200})`/g
// a bare token with a slash or a file extension: src/main/pty.ts, package.json, scripts/e2e/
const BARE = /(?:^|[\s("'[])((?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\/?)(?=$|[\s)"',;:\]!?])/g

/** Normalize to repo-relative with forward slashes; undefined for what can't be a project path. */
export function normalizePath(p: string, root?: string): string | undefined {
  let s = p.trim().replace(/\\/g, '/').replace(/^["'`]|["'`]$/g, '')
  if (root) {
    const r = root.replace(/\\/g, '/').replace(/\/$/, '')
    if (s === r) return undefined
    if (s.startsWith(`${r}/`)) s = s.slice(r.length + 1)
  }
  s = s.replace(/^\.\//, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/')
  if (!s || s === '.' || s.startsWith('../') || s.startsWith('/') || /^[a-z]:/i.test(s) || /^[a-z]+:\/\//i.test(s)) return undefined
  if (s.includes(' ') || s.length > 200) return undefined
  return s
}

/**
 * File and folder paths a note mentions: anything in backticks that looks like a path, and bare
 * tokens with a slash or an extension. Candidates only: the indexer keeps the ones that exist.
 */
export function extractPaths(text: string): string[] {
  const out = new Set<string>()
  const add = (raw: string): void => {
    const cleaned = raw.replace(/[.,;:]+$/, '').replace(/:\d+(?::\d+)?$/, '')
    if (!cleaned.includes('/') && !EXT.test(cleaned)) return
    if (/^\d+(\.\d+)+$/.test(cleaned) || /^v?\d/.test(cleaned) && !cleaned.includes('/')) return
    const p = normalizePath(cleaned)
    if (p) out.add(p)
  }
  for (const m of text.matchAll(CODE)) if (!/\s/.test(m[1].trim())) add(m[1].trim())
  const plain = text.replace(CODE, ' ')
  for (const m of plain.matchAll(BARE)) add(m[1])
  return [...out]
}

/** Does a note about `edge` concern `path`? The same file, or one inside the other (a folder). */
export function pathMatches(edge: string, path: string): boolean {
  return edge === path || path.startsWith(`${edge}/`) || edge.startsWith(`${path}/`)
}

// ── parsing the Markdown sources ─────────────────────────────────

const MEMORY_LINE = /^- (\d{4}-\d\d-\d\d): (.*?)(?: · files: (.+))?$/

/** Splits "note text (origin)" into its parts; the origin is the last parenthesized group. */
function splitOrigin(s: string): { text: string; origin?: string } {
  const m = /^(.*\S)\s+\(([^()]+)\)$/.exec(s)
  return m ? { text: m[1], origin: m[2] } : { text: s }
}

/** One node per dated line of `.sldev/memory.md`. */
export function parseMemory(text: string, source = '.sldev/memory.md'): ContextNode[] {
  const out: ContextNode[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    const m = MEMORY_LINE.exec(line)
    if (!m) return
    const { text: note, origin } = splitOrigin(m[2].trim())
    const listed = (m[3] ?? '').split(',').map((p) => normalizePath(p)).filter((p): p is string => !!p)
    out.push({ kind: 'learning', source, line: i + 1, title: note, body: note, day: m[1], origin, paths: [...new Set([...listed, ...extractPaths(note)])] })
  })
  return out
}

const FRONT = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const SECTION_MAX = 4000

/**
 * A Markdown doc as one node per section (# / ## / ### heading), so a hit points at the part that
 * matters. Text before the first heading belongs to a section titled after the file.
 */
export function parseDoc(text: string, source: string, kind: ContextKind = 'doc'): ContextNode[] {
  const lines = text.replace(FRONT, (m) => '\n'.repeat(m.split('\n').length - 1)).split(/\r?\n/)
  const fileTitle = source.split('/').pop()!.replace(/\.md$/i, '')
  const out: ContextNode[] = []
  let cur: { title: string; line: number; body: string[] } = { title: fileTitle, line: 1, body: [] }
  let fence = false
  const flush = (): void => {
    const body = cur.body.join('\n').trim()
    // a heading with nothing under it but subheadings has nothing to find
    if (!body) return
    out.push({ kind, source, line: cur.line, title: cur.title, body: body.slice(0, SECTION_MAX), paths: extractPaths(`${cur.title}\n${body}`) })
  }
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    const h = fence ? null : /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(l)
    if (h) {
      flush()
      cur = { title: h[2], line: i + 1, body: [] }
    } else cur.body.push(l)
  })
  flush()
  return out
}

/** A skill as one node: its name and description are what an agent decides on. */
export function parseSkill(text: string, source: string): ContextNode {
  const front = FRONT.exec(text)?.[1] ?? ''
  const field = (k: string): string | undefined => {
    const m = new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(front)
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : undefined
  }
  const dir = source.split('/').slice(-2, -1)[0] ?? source
  const name = field('name') ?? dir
  const description = field('description') ?? ''
  const rest = text.replace(FRONT, '').trim()
  return { kind: 'skill', source, line: 1, title: `Skill: ${name}`, body: `${description}\n\n${rest}`.trim().slice(0, SECTION_MAX), paths: extractPaths(rest) }
}

export interface PinnedFile {
  path: string
  note?: string
  line: number
}

const PINNED_LINE = /^- `([^`]+)`(?::\s*(.*))?$/

export const PINNED_HEADER = [
  '# Pinned context',
  '',
  'Files sldev-io offers to agents when a mission is about them. Edit freely; commit it to share with your team.',
  ''
].join('\n')

export function parsePinned(text: string): PinnedFile[] {
  const out: PinnedFile[] = []
  text.split(/\r?\n/).forEach((line, i) => {
    const m = PINNED_LINE.exec(line.trim())
    const path = m && normalizePath(m[1])
    if (path) out.push({ path, note: m[2]?.trim() || undefined, line: i + 1 })
  })
  return out
}

export function pinnedEntry(path: string, note?: string): string {
  const n = note?.replace(/\s+/g, ' ').trim()
  return `- \`${path}\`${n ? `: ${n}` : ''}`
}

/** A pinned file as a node: its note and path; Markdown files also get their sections indexed. */
export function pinnedNode(p: PinnedFile, content: string | null): ContextNode[] {
  // line 0: the whole file, so it never collides with a section that starts on line 1
  const head: ContextNode = { kind: 'file', source: p.path, line: 0, title: p.note ? `${p.path}: ${p.note}` : p.path, body: `${p.note ?? ''}\n${p.path.replace(/[/._-]+/g, ' ')}`.trim(), paths: [p.path] }
  if (!content || !/\.(md|mdx|markdown|txt)$/i.test(p.path)) return [head]
  return [head, ...parseDoc(content, p.path, 'file').map((n) => ({ ...n, paths: [...new Set([p.path, ...n.paths])] }))]
}

// ── search ───────────────────────────────────────────────────────

const STOP = new Set(
  'the and for with that this from into onto about what when where which while have has had was were are not but you your our its can could should would will shall then than them they there here also just only some any all each more most other such very make made use used using add fix get set new old one two out how why who does did done let lets need needs want please task mission work code file files project change changes'.split(' ')
)

/** Words worth searching for in a brief or a question. */
export function searchTerms(text: string, max = 24): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) ?? []
  return [...new Set(words.filter((w) => !STOP.has(w) && !/^\d+$/.test(w)))].slice(0, max)
}

/** An FTS5 MATCH expression: any of the terms, each quoted so nothing is read as syntax. */
export function ftsQuery(text: string): string | null {
  const terms = searchTerms(text)
  return terms.length ? terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ') : null
}

const KIND_WEIGHT: Record<ContextKind, number> = { learning: 1.5, doc: 1, file: 1.2, skill: 0.8 }

/**
 * Ranks full-text hits (bm25: lower is better) together with notes about the files the text names.
 * A note about a named file is a strong signal; learnings weigh a little more than reference text.
 */
export function rankHits(
  fts: Array<{ id: number; bm25: number }>,
  byPath: number[],
  kinds: Map<number, ContextKind>,
  limit: number
): Array<{ id: number; score: number }> {
  const score = new Map<number, number>()
  for (const r of fts) score.set(r.id, Math.max(0, -r.bm25))
  for (const id of byPath) score.set(id, (score.get(id) ?? 0) + 5)
  return [...score.entries()]
    .map(([id, s]) => ({ id, score: s * (KIND_WEIGHT[kinds.get(id) ?? 'doc'] ?? 1) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || b.id - a.id)
    .slice(0, limit)
}

// ── staleness ────────────────────────────────────────────────────

/** When a note was written, in ms: the end of its day for learnings, else its file's last change. */
export function writtenAt(n: Pick<ContextNode, 'day'>, sourceTime: number | undefined): number | undefined {
  if (n.day) {
    const [y, m, d] = n.day.split('-').map(Number)
    return new Date(y, m - 1, d + 1).getTime()
  }
  return sourceTime
}

/**
 * The first file a note is about that changed after the note was written, or that's gone.
 * `changedAt` holds each path's last change (commit time, or mtime outside git); undefined = missing.
 */
export function staleness(paths: string[], written: number | undefined, changedAt: Map<string, number | undefined>, ignore?: string): ContextStale | undefined {
  for (const p of paths) {
    if (p === ignore || !changedAt.has(p)) continue
    const t = changedAt.get(p)
    if (t === undefined) return { path: p, why: 'missing' }
    if (written !== undefined && t > written) return { path: p, why: 'changed' }
  }
  return undefined
}

// ── the mission prompt ───────────────────────────────────────────

const clipLine = (s: string, n: number): string => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

/** One line per hit: where to read it (absolute, so it works from a worktree too) and what it says. */
export function hitLine(h: ContextHit, root: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  const where = `${root.replace(/[\\/]$/, '')}${sep}${h.source.split('/').join(sep)}${h.line > 1 ? `:${h.line}` : ''}`
  const what = h.kind === 'learning' ? `${clipLine(h.title, 160)}${h.day ? ` (${h.day})` : ''}` : h.kind === 'file' && h.line === 0 ? `pinned: ${clipLine(h.title, 120)}` : clipLine(h.title, 120)
  const stale = h.stale ? ` [may be out of date: ${h.stale.path} ${h.stale.why === 'missing' ? 'is gone' : 'changed since'}]` : ''
  return `- ${where}: ${what}${stale}`
}

export interface PointerOptions {
  memoryPath: string
  memoryExists: boolean
  /** the agent has the sldev tools (sldev_remember, sldev_recall) */
  tools: boolean
}

/**
 * The lines a mission's prompt gets: the notes from the project context that match its brief, where
 * the whole memory is, and (with the sldev tools) how to look up more and add to it.
 */
export function contextPointer(hits: ContextHit[], root: string, o: PointerOptions): string {
  const parts: string[] = []
  if (o.memoryExists) parts.push(`Project memory: earlier agents and the team recorded what they learned about this project in ${o.memoryPath}. Read it before you start; it may save you time.`)
  if (hits.length) parts.push(`Project context that looks relevant to this task (read what applies; check anything marked out of date against the code):\n${hits.map((h) => hitLine(h, root)).join('\n')}`)
  const tools = [
    o.tools && (hits.length || o.memoryExists) ? 'Look up more with the sldev_recall tool, by topic or by file.' : '',
    o.tools ? 'If you learn something a future agent here should know (a gotcha, a command, a convention), record it in one line with the sldev_remember tool, with the files it is about.' : ''
  ]
    .filter(Boolean)
    .join(' ')
  if (tools) parts.push(tools)
  return parts.join('\n\n')
}

/** Text for sldev_recall: each hit with where it is, what it says, and the files it links to. */
export function recallText(hits: ContextHit[], root: string, related: string[] = []): string {
  if (!hits.length) return 'Nothing in the project context matches. Read the code, and record what you learn with sldev_remember.'
  const blocks = hits.map((h) => {
    const head = hitLine(h, root)
    const body = h.kind === 'learning' || h.body.trim() === h.title.trim() ? '' : `\n  ${clipLine(h.body, 600)}`
    const meta = [h.origin ? `from ${h.origin}` : '', h.paths.length ? `files: ${h.paths.slice(0, 8).join(', ')}` : ''].filter(Boolean).join(' · ')
    return `${head}${body}${meta ? `\n  ${meta}` : ''}`
  })
  const more = related.length ? `\n\nRelated files (other notes mention them too): ${related.slice(0, 12).join(', ')}` : ''
  return `${blocks.join('\n')}${more}`
}

// ── the "Map project" instructions ───────────────────────────────

/** What a Map mission (and the installable skill) asks for. Shared so both stay the same. */
export const MAP_INSTRUCTIONS = [
  `Write reference docs about this project for the agents that will work here after you, in ${CONTEXT_DIR}/. sldev-io indexes them and points each later mission at the sections that match its task.`,
  'First read the README, docs, package and build files, CI workflows, scripts and the main source folders. Then write these Markdown files, skipping one when there is nothing true to say:',
  [
    '- overview.md: what the project is, its main parts and where each lives',
    '- architecture.md: modules, entry points and how data flows between them',
    '- commands.md: install, run, test, lint, build and release, verified against the package files and CI',
    '- conventions.md: the code style, patterns, naming and testing approach the code actually follows',
    '- gotchas.md: traps, invariants, environment quirks, things that are easy to break'
  ].join('\n'),
  [
    'Rules:',
    '- One ## section per topic, short and specific. Search finds sections, not files.',
    '- Name the real files in backticks (`src/server/auth.ts`). sldev-io links each section to those files and flags it when they change.',
    "- Don't restate AGENTS.md, CLAUDE.md or other agent rules files; point to them.",
    "- Write only what you verified in the code. Mark guesses as such, or leave them out.",
    `- If ${CONTEXT_DIR}/ already has docs, update them instead of writing new ones beside them.`,
    '- If a recurring procedure with several steps stands out (a release, adding a module), you may also write it as a skill: .sldev/skills/<name>/SKILL.md with name and description front matter.',
    `- Create or change files only in ${CONTEXT_DIR}/ and .sldev/skills/. Do not commit.`
  ].join('\n')
].join('\n\n')

export const MAP_SKILL_PATH = '.sldev/skills/map-project/SKILL.md'

export const MAP_SKILL = `---
name: map-project
description: Map this project into reference docs in ${CONTEXT_DIR} (overview, architecture, commands, conventions, gotchas) that sldev-io indexes for every later agent. Use when asked to map, document or onboard onto the project, or when ${CONTEXT_DIR} is missing or out of date.
---

# Map this project

${MAP_INSTRUCTIONS}

End with the files you wrote and what you could not verify.
`
