import { acceptanceCriteria } from './board'
import type { DiffFile, DiffLine } from './diff'
import type { PrReview, ReviewState, ReviewTarget } from './types'

/**
 * The review cockpit: a diff read by what each part is for, not by file name. An agent (any agent, in
 * print mode) writes a walkthrough: parts in reading order, why each exists, whether it was asked for,
 * and a simpler way if there is one. Everything here is pure: splitting the diff into hunks, folding the
 * noise, flagging the risky spots, and putting the agent's parts over the real diff (a part can't claim
 * a hunk that doesn't exist, and a hunk no part claims is never hidden).
 */

export interface Hunk {
  /** `path#n`, n counting the file's @@ headers from 1 */
  id: string
  path: string
  /** 1-based, as `git diff` shows them */
  n: number
  header: string
  lines: DiffLine[]
  additions: number
  deletions: number
  status: DiffFile['status']
  /** why it is folded away, when it is noise */
  noise?: string
}

export type FlagId = 'auth' | 'money' | 'migration' | 'deps' | 'tests' | 'secret' | 'ci' | 'deletes' | 'suppressed' | 'unused'

export interface Flag {
  id: FlagId
  label: string
  why: string
}

/** asked: a criterion needs it; supports: what the asked part needs to work; extra: nobody asked for it */
export type Need = 'asked' | 'supports' | 'extra' | 'unknown'

export interface Part {
  id: string
  title: string
  why?: string
  need: Need
  /** criterion numbers (1-based) this part serves */
  serves: number[]
  simpler?: string
  risk?: string
  hunks: Hunk[]
  flags: Flag[]
  /** lines added and removed */
  lines: number
  source: 'agent' | 'auto'
}

export interface Criterion {
  n: number
  text: string
  /** the agent's verdict; undefined when nobody said */
  met?: boolean
  note?: string
  parts: string[]
}

export interface Cockpit {
  summary?: string
  parts: Part[]
  noise: Hunk[]
  criteria: Criterion[]
  totals: { lines: number; noise: number; asked: number; supports: number; extra: number; unknown: number }
}

// ── hunks and noise ──────────────────────────────────────────────────

const LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|uv\.lock|composer\.lock|Gemfile\.lock|go\.sum|flake\.lock|packages\.lock\.json)$/
const GENERATED = /(^|\/)(dist|build|out|coverage|\.next|vendor|node_modules|__generated__|generated)\/|\.min\.(js|css)$|\.map$|\.snap$|\.pb\.go$|_pb2\.py$|\.g\.dart$/

/** Why a whole file is noise, or undefined when it has to be read. */
export function fileNoise(f: Pick<DiffFile, 'path' | 'status' | 'additions' | 'deletions' | 'binary'>): string | undefined {
  if (LOCKFILE.test(f.path)) return 'lockfile'
  if (GENERATED.test(f.path)) return /\.snap$/.test(f.path) ? 'test snapshot' : 'generated'
  if (f.status === 'renamed' && !f.additions && !f.deletions) return 'renamed, no changes'
  return undefined
}

const squash = (s: string): string => s.replace(/\s+/g, '')

/** A hunk that only reformats or moves lines around: the same code before and after. */
export function hunkNoise(lines: DiffLine[]): string | undefined {
  const dels = lines.filter((l) => l.kind === 'del').map((l) => l.text)
  const adds = lines.filter((l) => l.kind === 'add').map((l) => l.text)
  if (!dels.length || !adds.length) return undefined
  if (squash(dels.join('')) === squash(adds.join(''))) return 'whitespace only'
  const sorted = (xs: string[]): string => xs.map((x) => x.trim()).filter(Boolean).sort().join('\n')
  if (sorted(dels) === sorted(adds)) return 'lines reordered'
  return undefined
}

export function hunksOf(files: DiffFile[]): Hunk[] {
  const out: Hunk[] = []
  for (const f of files) {
    const whole = fileNoise(f)
    let cur: Hunk | null = null
    const push = (): void => {
      if (!cur) return
      cur.noise = whole ?? hunkNoise(cur.lines)
      out.push(cur)
    }
    for (const l of f.lines) {
      if (l.kind === 'hunk') {
        push()
        const n: number = (cur?.n ?? 0) + 1
        cur = { id: `${f.path}#${n}`, path: f.path, n, header: l.text, lines: [], additions: 0, deletions: 0, status: f.status }
      } else if (cur) {
        cur.lines.push(l)
        if (l.kind === 'add') cur.additions++
        else if (l.kind === 'del') cur.deletions++
      }
    }
    push()
    // binary files, empty new files, pure renames: one hunk with nothing in it, so the file is still listed
    if (!f.lines.some((l) => l.kind === 'hunk')) out.push({ id: `${f.path}#1`, path: f.path, n: 1, header: f.binary ? 'Binary file' : f.status === 'renamed' ? `renamed from ${f.oldPath}` : f.status, lines: [], additions: 0, deletions: 0, status: f.status, noise: whole })
  }
  return out
}

// ── flags: the spots worth a second look ─────────────────────────────

export const isTest = (p: string): boolean => /(^|\/)(__tests__|tests?|spec|e2e)\/|[._-](test|spec)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/i.test(p)
export const isDocs = (p: string): boolean => /\.(md|mdx|rst|txt|adoc)$/i.test(p) || /(^|\/)docs?\//i.test(p)
const MANIFEST = /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|Cargo\.toml|go\.mod|Gemfile|composer\.json|build\.gradle(\.kts)?|pom\.xml|pubspec\.yaml|[^/]+\.csproj)$/

const SECRET = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bsk-[A-Za-z0-9_-]{20,}|\bxox[abp]-[A-Za-z0-9-]{10,}|(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"\s$]{12,}['"])/i
const SUPPRESS = /(eslint-disable|@ts-ignore|@ts-nocheck|# ?noqa|# ?type: ?ignore|\/\/ ?nolint|#\[allow\(|@SuppressWarnings|\bas any\b|\.(skip|only)\()/
const TEST_CASE = /\b(it|test|describe)(\.\w+)?\(|^\s*def test_|^\s*func Test/

/** The names of dependencies a manifest hunk adds. */
export function addedDeps(path: string, lines: DiffLine[]): string[] {
  if (!MANIFEST.test(path)) return []
  const removed = new Set<string>()
  const added: string[] = []
  const name = (t: string): string | undefined => {
    if (/package\.json$|composer\.json$/.test(path)) {
      const m = /^\s*"(@?[\w.-]+(?:\/[\w.-]+)?)"\s*:\s*"[\^~>=<*\d]/.exec(t)
      return m && !['version', 'node', 'npm'].includes(m[1]) ? m[1] : undefined
    }
    if (/requirements[^/]*\.txt$/.test(path)) return /^\s*([A-Za-z][\w.-]*)\s*(\[|[=<>~!]|$)/.exec(t)?.[1]
    if (/go\.mod$/.test(path)) return /^\s*(?:require\s+)?([\w.-]+\.[a-z]{2,}\/\S+)\s+v\d/.exec(t)?.[1]
    if (/Gemfile$/.test(path)) return /^\s*gem\s+['"]([\w-]+)['"]/.exec(t)?.[1]
    // TOML: name = "1.2" or name = { version = … }
    return /^\s*([A-Za-z][\w-]*)\s*=\s*(["{]|\d)/.exec(t)?.[1]
  }
  for (const l of lines) {
    const n = l.kind === 'add' || l.kind === 'del' ? name(l.text) : undefined
    if (!n) continue
    if (l.kind === 'del') removed.add(n)
    else added.push(n)
  }
  // a version bump removes and adds the same name: not a new dependency
  return [...new Set(added.filter((n) => !removed.has(n)))]
}

export function hunkFlags(h: Hunk): Flag[] {
  const flags: Flag[] = []
  const add = (id: FlagId, label: string, why: string): void => void (flags.some((f) => f.id === id) || flags.push({ id, label, why }))
  const p = h.path
  const added = h.lines.filter((l) => l.kind === 'add').map((l) => l.text)
  const removed = h.lines.filter((l) => l.kind === 'del').map((l) => l.text)
  const test = isTest(p)
  if (/(^|[/_.-])(auth\w*|login|logout|session|sessions|passwords?|permissions?|roles?|acl|oauth|jwt|csrf|cors|crypto|security|sso|saml)([/_.-]|$)/i.test(p) && !test) add('auth', 'Auth', 'touches sign-in, sessions or permissions')
  if (/(billing|payments?|invoices?|checkout|pricing|prices?|stripe|paddle|polar|subscriptions?|refunds?|wallet|ledger)/i.test(p) && !test) add('money', 'Money', 'touches billing or payments')
  if (/(^|\/)(migrations?|migrate|alembic)\/|schema\.prisma$|\.sql$/i.test(p)) add('migration', 'Migration', 'changes the database schema or data')
  const deps = addedDeps(p, h.lines)
  if (deps.length) add('deps', deps.length === 1 ? 'New dependency' : `${deps.length} new dependencies`, `adds ${deps.slice(0, 4).join(', ')}${deps.length > 4 ? '…' : ''}`)
  if (test && (h.status === 'deleted' || removed.filter((t) => TEST_CASE.test(t)).length > added.filter((t) => TEST_CASE.test(t)).length)) add('tests', 'Tests removed', h.status === 'deleted' ? 'deletes a test file' : 'removes more test cases than it adds')
  if (added.some((t) => SECRET.test(t))) add('secret', 'Looks like a secret', 'a key or password written into the code')
  if (/(^|\/)\.github\/workflows\/|\.gitlab-ci\.yml$|(^|\/)Dockerfile|docker-compose|(^|\/)(deploy|infra|terraform|k8s|helm)\//i.test(p)) add('ci', 'CI or deploy', 'changes how it builds or ships')
  if (!test && (h.status === 'deleted' || h.deletions >= 150)) add('deletes', h.status === 'deleted' ? 'File deleted' : 'Large deletion', h.status === 'deleted' ? 'removes a whole file' : `removes ${h.deletions} lines`)
  const sup = added.find((t) => SUPPRESS.test(t))
  if (sup) add('suppressed', test && /\.(skip|only)\(/.test(sup) ? 'Test skipped' : 'Check silenced', `"${sup.trim().slice(0, 60)}"`)
  return flags
}

// ── overengineering: new things nothing uses ─────────────────────────

const EXPORTED = /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|interface|type|function\*?|const|let|enum)\s+([A-Za-z_$][\w$]*)/
const PY_DEF = /^(?:class|def|async def)\s+([A-Za-z]\w*)/
const GO_FUNC = /^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/

/**
 * Names a change exports or defines at the top level that nothing else in the change uses: new code
 * can only be used by code that changed too, so an unused one is either dead or there for later.
 * Tests, entry points and type-only files are left out (they're meant to stand alone).
 */
export function unusedNew(hunks: Hunk[]): Array<{ name: string; hunk: string }> {
  const defs: Array<{ name: string; hunk: string; line: string }> = []
  for (const h of hunks) {
    if (h.noise || isTest(h.path) || isDocs(h.path) || /(^|\/)(index|main|mod|__init__|cli|app)\.[a-z]+$|\.d\.ts$/.test(h.path)) continue
    for (const l of h.lines) {
      if (l.kind !== 'add') continue
      const m = EXPORTED.exec(l.text) ?? (/\.py$/.test(h.path) ? PY_DEF.exec(l.text) : null) ?? (/\.go$/.test(h.path) ? GO_FUNC.exec(l.text) : null)
      // and only when it's new: the same name wasn't removed (a rewritten function isn't new)
      if (m && m[1].length > 2 && !h.lines.some((x) => x.kind === 'del' && x.text.includes(m[1]))) defs.push({ name: m[1], hunk: h.id, line: l.text })
    }
  }
  const text = hunks.flatMap((h) => h.lines.filter((l) => l.kind !== 'del').map((l) => l.text))
  return defs
    .filter((d) => {
      const word = new RegExp(`(^|[^\\w$])${d.name.replace(/\$/g, '\\$')}([^\\w$]|$)`)
      return text.filter((t) => word.test(t)).length <= 1
    })
    .map(({ name, hunk }) => ({ name, hunk }))
}

// ── the walkthrough an agent writes ──────────────────────────────────

export interface Walkthrough {
  summary?: string
  parts: Array<{ title: string; why?: string; need?: Need; serves?: number[]; simpler?: string; risk?: string; files: Array<{ path: string; hunks?: number[] }> }>
  criteria?: Array<{ n: number; met?: boolean; note?: string }>
}

const str = (v: unknown, max = 800): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const nums = (v: unknown): number[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]).map(Number).filter((n) => Number.isInteger(n) && n > 0)
const NEEDS: Need[] = ['asked', 'supports', 'extra']

/** The agent's JSON (the whole file, or the last ```json block in it), or null when there is none. */
export function parseWalkthrough(text: string): Walkthrough | null {
  const blocks = [text.trim(), ...[...text.matchAll(/```(?:json)?[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1])].reverse()
  for (const b of blocks) {
    let v: unknown
    try {
      v = JSON.parse(b)
    } catch {
      continue
    }
    const o = (Array.isArray(v) ? { parts: v } : v) as Record<string, unknown>
    if (!o || typeof o !== 'object' || !Array.isArray(o.parts)) continue
    const parts = (o.parts as unknown[])
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map((p) => ({
        title: str(p.title, 120) ?? 'Untitled part',
        why: str(p.why),
        need: NEEDS.includes(p.need as Need) ? (p.need as Need) : undefined,
        serves: nums(p.serves),
        simpler: str(p.simpler),
        risk: str(p.risk),
        files: (Array.isArray(p.files) ? p.files : [])
          .map((f: unknown) => (typeof f === 'string' ? { path: f } : f && typeof f === 'object' && typeof (f as { path?: unknown }).path === 'string' ? { path: (f as { path: string }).path, hunks: nums((f as { hunks?: unknown }).hunks) } : null))
          .filter((f): f is { path: string; hunks: number[] } => !!f)
      }))
      .slice(0, 30)
    if (!parts.length) continue
    const criteria = Array.isArray(o.criteria)
      ? (o.criteria as unknown[])
          .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
          .map((c) => ({ n: Number(c.n), met: typeof c.met === 'boolean' ? c.met : undefined, note: str(c.note, 300) }))
          .filter((c) => Number.isInteger(c.n) && c.n > 0)
      : undefined
    return { summary: str(o.summary, 1200), parts, criteria }
  }
  return null
}

const cleanPath = (p: string): string => p.trim().replace(/^\.\//, '').replace(/^[ab]\//, '').replace(/\\/g, '/')

/** The acceptance criteria of a mission: its criteria field, or the section of its brief (a board card's story). */
export function criteriaOf(m: { criteria?: string; brief?: string }): string[] {
  const lines = (m.criteria ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s*(?:\[[ xX]\]\s*)?/, '').trim())
    .filter(Boolean)
  return lines.length ? lines : acceptanceCriteria(m.brief ?? '')
}

// ── the cockpit: the walkthrough over the real diff ──────────────────

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'part'
}

/** Groups for a diff nobody explained yet: the code by folder (biggest first), then config, tests and docs. */
function autoParts(hunks: Hunk[]): Array<{ id: string; title: string; hunks: Hunk[] }> {
  const groups = new Map<string, { id: string; title: string; hunks: Hunk[]; rank: number }>()
  for (const h of hunks) {
    const dir = h.path.includes('/') ? h.path.split('/').slice(0, Math.min(2, h.path.split('/').length - 1)).join('/') : ''
    const [key, title, rank] = isTest(h.path)
      ? ['tests', 'Tests', 2]
      : isDocs(h.path)
        ? ['docs', 'Docs', 3]
        : MANIFEST.test(h.path) || /(^|\/)\.|\.(json|ya?ml|toml|ini|cfg|conf)$/i.test(h.path)
          ? ['config', 'Config and dependencies', 1]
          : [`code:${dir}`, dir ? `Changes in ${dir}` : 'Changes at the top level', 0]
    const g = groups.get(key) ?? { id: `auto:${slug(key)}`, title, hunks: [], rank }
    g.hunks.push(h)
    groups.set(key, g)
  }
  const size = (g: { hunks: Hunk[] }): number => g.hunks.reduce((a, h) => a + h.additions + h.deletions, 0)
  return [...groups.values()].sort((a, b) => a.rank - b.rank || size(b) - size(a))
}

export function buildCockpit(files: DiffFile[], walk: Walkthrough | null, criteria: string[]): Cockpit {
  const all = hunksOf(files)
  const noise = all.filter((h) => h.noise)
  const real = all.filter((h) => !h.noise)
  const byPath = new Map<string, Hunk[]>()
  for (const h of real) byPath.set(h.path, [...(byPath.get(h.path) ?? []), h])
  const claimed = new Set<string>()
  const parts: Part[] = []
  const used = new Set<string>()
  const idFor = (title: string): string => {
    let id = slug(title)
    for (let i = 2; used.has(id); i++) id = `${slug(title)}-${i}`
    used.add(id)
    return id
  }

  for (const p of walk?.parts ?? []) {
    const hunks: Hunk[] = []
    for (const f of p.files) {
      const path = cleanPath(f.path)
      const mine = byPath.get(path) ?? byPath.get([...byPath.keys()].find((k) => k.endsWith(`/${path}`)) ?? '') ?? []
      for (const h of mine) if ((!f.hunks?.length || f.hunks.includes(h.n)) && !claimed.has(h.id)) (claimed.add(h.id), hunks.push(h))
    }
    // a part about nothing that's in the diff is the agent's mistake; don't show an empty part
    if (!hunks.length) continue
    parts.push(part(idFor(p.title), p.title, hunks, 'agent', { why: p.why, need: p.need ?? 'unknown', serves: (p.serves ?? []).filter((n) => n <= criteria.length), simpler: p.simpler, risk: p.risk }))
  }
  const left = real.filter((h) => !claimed.has(h.id))
  if (walk && left.length) parts.push(part(idFor('Not in the walkthrough'), 'Not in the walkthrough', left, 'auto', { why: 'The agent did not explain these changes.', need: 'unknown' }))
  if (!walk) for (const g of autoParts(left)) parts.push(part(g.id, g.title, g.hunks, 'auto', { need: 'unknown' }))

  // new names nothing in the change uses: a hint of building for later
  for (const u of unusedNew(real)) {
    const p = parts.find((x) => x.hunks.some((h) => h.id === u.hunk))
    if (!p) continue
    const f = p.flags.find((x) => x.id === 'unused')
    if (f) f.why = `${f.why}, ${u.name}`
    else p.flags.push({ id: 'unused', label: 'Unused new code', why: `nothing in this change uses ${u.name}` })
  }

  const totals = { lines: 0, noise: noise.reduce((a, h) => a + h.additions + h.deletions, 0), asked: 0, supports: 0, extra: 0, unknown: 0 }
  for (const p of parts) {
    totals.lines += p.lines
    totals[p.need] += p.lines
  }
  return {
    summary: walk?.summary,
    parts,
    noise,
    totals,
    criteria: criteria.map((text, i) => {
      const v = walk?.criteria?.find((c) => c.n === i + 1)
      return { n: i + 1, text, met: v?.met, note: v?.note, parts: parts.filter((p) => p.serves.includes(i + 1)).map((p) => p.id) }
    })
  }
}

function part(id: string, title: string, hunks: Hunk[], source: Part['source'], o: Partial<Part> & { need: Need }): Part {
  const flags: Flag[] = []
  for (const h of hunks) for (const f of hunkFlags(h)) if (!flags.some((x) => x.id === f.id)) flags.push(f)
  return { id, title, serves: [], ...o, hunks, flags, lines: hunks.reduce((a, h) => a + h.additions + h.deletions, 0), source }
}

// ── prompts ──────────────────────────────────────────────────────────

export interface ReviewSubject {
  title: string
  brief?: string
  report?: string
  criteria: string[]
  /** git diff <base> shows the work */
  base: string
  /** how to see the change when it isn't `git diff <base>` in this folder (a pull request: gh pr diff) */
  diff?: string
}

const changeOf = (s: ReviewSubject): string => (s.diff ? `\`${s.diff}\`` : `\`git diff ${s.base}\` plus untracked files in this folder`)

/** What a walkthrough agent is asked: read-only, the JSON to one file. */
export function walkthroughPrompt(s: ReviewSubject, files: Array<{ path: string; hunks: number; lines: number }>, file: string): string {
  return [
    `Walkthrough: explain the change for "${s.title}" to its reviewer`,
    `A reviewer is about to read this change. Don't summarize it file by file: explain it by what each part is for, so they can judge whether it is needed.`,
    s.brief?.trim() ? `What was asked:\n\n${s.brief.trim().slice(0, 4000)}` : '',
    s.criteria.length ? `Acceptance criteria (numbered):\n${s.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : '',
    s.report?.trim() ? `What the agent that did the work said:\n\n${s.report.trim().slice(0, 2500)}` : '',
    `The change is ${changeOf(s)}. Read it, and whatever code around it you need. The changed files (hunks are counted by their @@ headers, from 1):\n${files.map((f) => `- ${f.path} (${f.hunks} hunk${f.hunks === 1 ? '' : 's'}, ${f.lines} lines)`).join('\n')}`,
    [
      'Split the change into 2 to 8 parts in reading order: the core change first, then what it needs, then tests and the rest. For each part:',
      '- title: what it does, in a few words',
      '- why: one or two sentences on why it is there',
      '- need: "asked" (a criterion or the request needs it), "supports" (the asked part needs it to work) or "extra" (nobody asked for it: refactors, options, abstractions or files for later). Be honest; extra is not a judgement, just a fact the reviewer needs.',
      '- serves: the criterion numbers it meets',
      '- simpler: a simpler way to do the same, only if there clearly is one (fewer files, no new abstraction, an existing helper); leave it out otherwise',
      '- risk: what could break because of it, only if something could',
      '- files: [{"path": "...", "hunks": [1, 2]}] (leave hunks out for the whole file); every hunk belongs to exactly one part. Leave out lockfiles and generated files.'
    ].join('\n'),
    s.criteria.length ? 'For each criterion, say whether the change meets it: criteria: [{"n": 1, "met": true, "note": "…"}].' : '',
    `Write it as JSON to ${file} (the one file you may create; do not change anything else and do not commit):\n{"summary": "two or three sentences: what changed, and whether it is what was asked", "parts": [{"title": "…", "why": "…", "need": "asked", "serves": [1], "simpler": "…", "risk": "…", "files": [{"path": "src/x.ts", "hunks": [1]}]}], "criteria": [{"n": 1, "met": true, "note": "…"}]}`,
    'Then say in one line that the walkthrough is written.'
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Text of a part's hunks, as a reviewer quotes them to an agent. */
export function partText(p: Pick<Part, 'hunks'>, max = 6000): string {
  const out: string[] = []
  for (const h of p.hunks) {
    out.push(`--- ${h.path} ${h.header}`)
    for (const l of h.lines) out.push(`${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.text}`)
  }
  const s = out.join('\n')
  return s.length > max ? `${s.slice(0, max)}\n[…]` : s
}

/** A reviewer's question about one part, answered by a read-only agent into a file. */
export function askPrompt(s: ReviewSubject, p: Pick<Part, 'title' | 'why' | 'hunks'>, question: string, file: string): string {
  return [
    `Question about the change for "${s.title}": ${question.trim()}`,
    s.brief?.trim() ? `What was asked:\n\n${s.brief.trim().slice(0, 3000)}` : '',
    s.report?.trim() ? `What the agent that did the work said:\n\n${s.report.trim().slice(0, 2000)}` : '',
    `The reviewer is looking at this part, "${p.title}"${p.why ? ` (${p.why})` : ''}:\n\n\`\`\`diff\n${partText(p)}\n\`\`\``,
    `The whole change is ${s.diff ? `\`${s.diff}\`` : `\`git diff ${s.base}\``}; read any code you need. Answer the question in at most six sentences, plainly, naming files and lines. If the honest answer is that it isn't needed, say so, and say what to remove.`,
    `Write the answer as Markdown to ${file} (the one file you may create; do not change anything else and do not commit), then say in one line that it is written.`
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** What a follow-up is told when the reviewer sends parts back: each part, its files, the note. */
export function sendBackText(items: Array<{ part: Pick<Part, 'title' | 'hunks'>; note: string }>): string {
  const files = (p: Pick<Part, 'hunks'>): string => [...new Set(p.hunks.map((h) => h.path))].slice(0, 5).join(', ')
  return [
    `The reviewer went through your change part by part and sent ${items.length === 1 ? 'one part' : `${items.length} parts`} back:`,
    items.map((x, i) => `${i + 1}. ${x.part.title} (${files(x.part)}): ${x.note.trim()}`).join('\n'),
    'Change only what these notes ask for, and keep the rest of the change as it is.'
  ].join('\n\n')
}

/** The note a "Cut it" button writes for a part nobody asked for. */
export const CUT_NOTE = 'Remove this part: it wasn\'t asked for. Keep the change to what the task needs.'

// ── review order and time ────────────────────────────────────────────

/** Flags that send a part to the front: the spots where a missed line costs the most. */
const RISKY: Partial<Record<FlagId, number>> = { secret: 6, tests: 5, suppressed: 4, auth: 3, money: 3, migration: 3 }

/** Lines a reviewer reads in a minute, carefully (code review studies put it at 300 to 500 an hour). */
export const LINES_PER_MINUTE = 8
/** Minutes a risky flag adds to its part (a second look), and any other flag. */
export const RISKY_FLAG_MINUTES = 2
export const FLAG_MINUTES = 0.5

const riskOf = (p: Pick<Part, 'flags'>): number => p.flags.reduce((a, f) => a + (RISKY[f.id] ?? 0), 0)

/**
 * The parts in the order to read them: risky flags first (the riskiest ahead), then parts nobody asked
 * for, then the rest, biggest first in each. Ties keep the cockpit's own order. Noise isn't a part: it
 * stays folded at the end.
 */
export function reviewOrder(c: Pick<Cockpit, 'parts'>): Part[] {
  const tier = (p: Part): number => (riskOf(p) ? 0 : p.need === 'extra' ? 1 : 2)
  return c.parts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => tier(a.p) - tier(b.p) || riskOf(b.p) - riskOf(a.p) || b.p.lines - a.p.lines || a.i - b.i)
    .map((x) => x.p)
}

/** The parts by the first file they touch, as a file list reads. */
export function fileOrder(c: Pick<Cockpit, 'parts'>): Part[] {
  const key = (p: Part): string => p.hunks.map((h) => `${h.path}\0${String(h.n).padStart(5, '0')}`).sort()[0] ?? ''
  return c.parts
    .map((p, i) => ({ p, i, k: key(p) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))
    .map((x) => x.p)
}

/** Minutes to review one part: its lines at a set pace, plus a second look per flag. */
export function partMinutes(p: Pick<Part, 'lines' | 'flags'>): number {
  const flags = p.flags.reduce((a, f) => a + (RISKY[f.id] ? RISKY_FLAG_MINUTES : FLAG_MINUTES), 0)
  return p.lines / LINES_PER_MINUTE + flags
}

/** Minutes for the whole review (noise is folded, so it isn't counted), and for the parts still without a verdict. */
export function reviewMinutes(c: Pick<Cockpit, 'parts'>, done: (p: Part) => boolean = () => false): { total: number; left: number } {
  let total = 0
  let left = 0
  for (const p of c.parts) {
    const m = partMinutes(p)
    total += m
    if (!done(p)) left += m
  }
  return { total, left }
}

/** "about 12 min", "about 1 h 25 min", "under a minute". */
export function formatMinutes(min: number): string {
  if (min <= 0) return 'nothing to read'
  if (min < 1) return 'under a minute'
  if (min < 60) return `about ${Math.round(min)} min`
  const m = Math.round(min / 5) * 5
  const h = Math.floor(m / 60)
  return `about ${h} h${m % 60 ? ` ${m % 60} min` : ''}`
}

// ── review state of pull requests (prReviews.json) ───────────────────

/** A pull request's key: the repository it was opened in and its number. */
export const prReviewKey = (root: string, number: number): string => `${root.replace(/\/+$/, '')}#${number}`

export function findPrReview(list: PrReview[], root: string, number: number): PrReview | undefined {
  const key = prReviewKey(root, number)
  return list.find((r) => prReviewKey(r.root, r.number) === key)
}

/** The list with one PR's review state changed; `head` (when known) is the commit the marks are now about. */
export function putPrReview(list: PrReview[], root: string, number: number, f: (r: ReviewState) => ReviewState, head?: string, at = Date.now()): PrReview[] {
  const old = findPrReview(list, root, number)
  const next: PrReview = { root: old?.root ?? root, number, head: head ?? old?.head, review: f(old?.review ?? {}), updatedAt: at }
  return old ? list.map((r) => (r === old ? next : r)) : [...list, next]
}

/** A saved Review tab's params: newer ones carry a target, layouts saved before targets only a missionId. */
export function targetOf(params: { target?: ReviewTarget; missionId?: string } | undefined): ReviewTarget | undefined {
  if (params?.target) return params.target
  return params?.missionId ? { kind: 'mission', id: params.missionId } : undefined
}
