import { acceptanceCriteria } from './board'
import type { DiffFile, DiffLine } from './diff'

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

export type FlagId = 'auth' | 'money' | 'migration' | 'deps' | 'tests' | 'secret' | 'ci' | 'deletes' | 'suppressed' | 'unused' | 'signature'

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
  const sig = signatureChanges(h)
  if (sig.length) add('signature', 'Signature changed', `${sig.map((x) => x.name).slice(0, 3).join(', ')}${sig.length > 3 ? '…' : ''}: ${sig[0].why}, callers may need updating`)
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

// ── blast radius: callers of changed code the change left alone ──────

/** The top-level name a line defines (exported for TS/JS, any def for Python, exported funcs for Go), or undefined. */
export function definedName(path: string, text: string): string | undefined {
  const m = EXPORTED.exec(text) ?? (/\.py$/.test(path) ? PY_DEF.exec(text) : null) ?? (/\.go$/.test(path) ? GO_FUNC.exec(text) : null)
  return m && m[1].length > 2 ? m[1] : undefined
}

const reEsc = (s: string): string => s.replace(/[$]/g, '\\$')

/**
 * The parameter list of `name`'s definition starting at line `i`, read on one side of the hunk (old: removed
 * and context lines, new: added and context lines), whitespace squeezed. Undefined when it isn't a function
 * (a type, a class, a plain constant) or the list doesn't close within a few lines.
 */
function paramsAt(lines: DiffLine[], i: number, side: 'old' | 'new', name: string): string | undefined {
  const skip = side === 'old' ? 'add' : 'del'
  const text = lines
    .slice(i)
    .filter((l) => l.kind !== skip && l.kind !== 'hunk' && l.kind !== 'meta')
    .slice(0, 12)
    .map((l) => l.text)
    .join('\n')
  // types, interfaces and classes have no parameter list of their own (a class's bases aren't one)
  if (new RegExp(`\\b(?:class|interface|type|enum)\\s+${reEsc(name)}(?![\\w$])`).test(text)) return undefined
  const at = new RegExp(`(^|[^\\w$])${reEsc(name)}(?![\\w$])`).exec(text)
  if (!at) return undefined
  const rest = text.slice(at.index + at[0].length)
  // a constant is a function only when an arrow or function expression is assigned
  if (/^\s*[:=]/.test(rest) && !/^\s*(?::[^=]*)?=\s*(?:async\s*)?(?:function\b[^(]*)?(?:<[^>]*>)?\s*\(/.test(rest)) return undefined
  const open = rest.indexOf('(')
  if (open < 0 || /[{;]/.test(rest.slice(0, open))) return undefined
  let depth = 0
  for (let j = open; j < rest.length; j++) {
    const c = rest[j]
    if (c === '(' || c === '[' || c === '{' || c === '<') depth++
    else if ((c === ')' || c === ']' || c === '}' || c === '>') && rest[j - 1] !== '=') depth--
    if (depth === 0) return rest.slice(open + 1, j).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*/g, '').replace(/\s+/g, ' ').replace(/\s*([,:=()<>[\]{}|?])\s*/g, '$1').replace(/,$/, '').trim()
  }
  return undefined
}

const paramCount = (p: string): number => {
  if (!p) return 0
  let depth = 0
  let n = 1
  for (const c of p) {
    if ('([{<'.includes(c)) depth++
    else if (')]}>'.includes(c)) depth--
    else if (c === ',' && depth === 0) n++
  }
  return n
}

/** Functions whose parameter list a hunk changed (added, removed, renamed or retyped a parameter); a body-only change isn't one. */
export function signatureChanges(h: Pick<Hunk, 'path' | 'lines' | 'noise'>): Array<{ name: string; before: string; after: string; why: string }> {
  if (h.noise) return []
  const out: Array<{ name: string; before: string; after: string; why: string }> = []
  const dels = new Map<string, number>()
  const adds = new Map<string, number>()
  h.lines.forEach((l, i) => {
    const n = l.kind === 'del' || l.kind === 'add' ? definedName(h.path, l.text) : undefined
    if (n) (l.kind === 'del' ? dels : adds).has(n) || (l.kind === 'del' ? dels : adds).set(n, i)
  })
  // a parameter on its own line changes inside a definition whose first line is context
  h.lines.forEach((l, i) => {
    const n = l.kind === 'ctx' ? definedName(h.path, l.text) : undefined
    if (n && !dels.has(n) && !adds.has(n)) (dels.set(n, i), adds.set(n, i))
  })
  for (const [name, di] of dels) {
    const ai = adds.get(name)
    if (ai === undefined) continue
    const before = paramsAt(h.lines, di, 'old', name)
    const after = paramsAt(h.lines, ai, 'new', name)
    if (before === undefined || after === undefined || before === after) continue
    const [b, a] = [paramCount(before), paramCount(after)]
    out.push({ name, before, after, why: a > b ? `${a - b === 1 ? 'a parameter' : `${a - b} parameters`} added` : a < b ? `${b - a === 1 ? 'a parameter' : `${b - a} parameters`} removed` : 'its parameters changed' })
  }
  return out
}

export interface ChangedName {
  name: string
  /** the hunk that changed it */
  hunk: string
  path: string
  /** signature: its parameters changed; removed: the definition is gone; body: it changed inside */
  kind: 'signature' | 'removed' | 'body'
}

/**
 * Names that existed before the change and that it changed: their signature, their body (the hunk sits in
 * them, by git's @@ context or a definition line in the hunk) or removed them. New names aren't here
 * (nothing outside the change can call them yet; unusedNew covers those), nor tests, docs and noise.
 */
export function changedNames(hunks: Hunk[]): ChangedName[] {
  const out = new Map<string, ChangedName>()
  const addedAnywhere = new Set<string>()
  for (const h of hunks) for (const l of h.lines) if (l.kind === 'add') { const n = definedName(h.path, l.text); if (n) addedAnywhere.add(n) }
  const put = (c: ChangedName): void => {
    const was = out.get(c.name)
    const rank = { signature: 2, removed: 1, body: 0 }
    if (!was || rank[c.kind] > rank[was.kind]) out.set(c.name, c)
  }
  for (const h of hunks) {
    if (h.noise || h.status === 'added' || isTest(h.path) || isDocs(h.path) || !h.lines.some((l) => l.kind === 'add' || l.kind === 'del')) continue
    for (const s of signatureChanges(h)) put({ name: s.name, hunk: h.id, path: h.path, kind: 'signature' })
    for (const l of h.lines) {
      const n = definedName(h.path, l.text)
      if (!n) continue
      if (l.kind === 'del') put({ name: n, hunk: h.id, path: h.path, kind: addedAnywhere.has(n) ? 'body' : 'removed' })
      else if (l.kind === 'ctx') put({ name: n, hunk: h.id, path: h.path, kind: 'body' })
    }
    // git names the enclosing function in the @@ line: the hunk changed its body
    const ctx = definedName(h.path, /^@@[^@]*@@\s?(.*)$/.exec(h.header)?.[1] ?? '')
    if (ctx) put({ name: ctx, hunk: h.id, path: h.path, kind: 'body' })
  }
  return [...out.values()]
}

/** One place a name is used: a line of `git grep`. */
export interface Use {
  path: string
  line: number
  text: string
}

/** `git grep -z -n` output: path NUL line NUL text. */
export function parseGrep(out: string, max = 2000): Use[] {
  const uses: Use[] = []
  for (const row of out.split('\n')) {
    const [path, line, ...text] = row.split('\0')
    if (!path || !/^\d+$/.test(line ?? '')) continue
    uses.push({ path: path.replace(/\\/g, '/'), line: Number(line), text: text.join('\0').slice(0, 300) })
    if (uses.length >= max) break
  }
  return uses
}

export interface Radius {
  name: string
  hunk: string
  kind: ChangedName['kind']
  /** places outside its own definition */
  uses: number
  /** of those, on lines the change wrote */
  changed: number
  untouched: Use[]
}

const IMPORT_LINE = /^\s*(?:import\b|from\s+\S+\s+import\b|export\s+(?:type\s+)?\{[^}]*\}\s*from\b|(?:const|let|var)\s+\{[^}]*\}\s*=\s*require\(|use\s)/

/** What `git grep` found per changed name: how many other places use it, how many the change touched, and the rest. */
export function blastRadius(names: ChangedName[], hunks: Hunk[], found: Use[]): Radius[] {
  const written = new Set<string>()
  for (const h of hunks) for (const l of h.lines) if (l.kind === 'add' && l.newNo) written.add(`${h.path}:${l.newNo}`)
  return names.map((n) => {
    const word = new RegExp(`(^|[^\\w$])${reEsc(n.name)}([^\\w$]|$)`)
    // an import isn't a caller: it needs no change when the parameters or the body do (it does when the name is gone)
    const uses = found.filter((u) => word.test(u.text) && definedName(u.path, u.text) !== n.name && (n.kind === 'removed' || !IMPORT_LINE.test(u.text)))
    const untouched = uses.filter((u) => !written.has(`${u.path}:${u.line}`))
    return { name: n.name, hunk: n.hunk, kind: n.kind, uses: uses.length, changed: uses.length - untouched.length, untouched }
  })
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
}

/** What a walkthrough agent is asked: read-only, the JSON to one file. */
export function walkthroughPrompt(s: ReviewSubject, files: Array<{ path: string; hunks: number; lines: number }>, file: string): string {
  return [
    `Walkthrough: explain the change for "${s.title}" to its reviewer`,
    `A reviewer is about to read this change. Don't summarize it file by file: explain it by what each part is for, so they can judge whether it is needed.`,
    s.brief?.trim() ? `What was asked:\n\n${s.brief.trim().slice(0, 4000)}` : '',
    s.criteria.length ? `Acceptance criteria (numbered):\n${s.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : '',
    s.report?.trim() ? `What the agent that did the work said:\n\n${s.report.trim().slice(0, 2500)}` : '',
    `The change is \`git diff ${s.base}\` plus untracked files in this folder. Read it, and whatever code around it you need. The changed files (hunks are counted by their @@ headers, from 1):\n${files.map((f) => `- ${f.path} (${f.hunks} hunk${f.hunks === 1 ? '' : 's'}, ${f.lines} lines)`).join('\n')}`,
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
    `The whole change is \`git diff ${s.base}\`; read any code you need. Answer the question in at most six sentences, plainly, naming files and lines. If the honest answer is that it isn't needed, say so, and say what to remove.`,
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
