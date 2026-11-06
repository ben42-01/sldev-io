/**
 * Code diagrams, parsed locally from source: a folder-level import graph for TS/JS and an entity
 * relationship diagram from Prisma schemas and SQL `CREATE TABLE`s. Pure, so main scans and the
 * renderer only draws. No type checker: imports and schema are read with small, forgiving parsers.
 */

export const CODE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const RESOLVE_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
const INDEX = RESOLVE_EXT.map((e) => `/index${e}`)

export interface GraphNode {
  /** folder (or file, at the deepest level) relative to the project root */
  id: string
  files: number
}
export interface GraphEdge {
  from: string
  to: string
  /** imports from files in `from` to files in `to` */
  count: number
}
export interface CodeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** source files read (capped) and whether the cap was hit */
  scanned: number
  truncated: boolean
}

export interface Column {
  name: string
  type: string
  pk?: boolean
  nullable?: boolean
}
export interface Table {
  name: string
  columns: Column[]
  /** project-relative file and 1-based line, to open it in the editor */
  file: string
  line: number
}
export interface Relation {
  from: string
  fromColumns: string[]
  to: string
  toColumns: string[]
}
export interface SchemaGraph {
  tables: Table[]
  relations: Relation[]
  /** schema files read */
  sources: string[]
}

// ---------- imports ----------

/** Module specifiers of `import … from`, `export … from`, `import('…')` and `require('…')`. */
export function parseImports(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
  const out = new Set<string>()
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"\n]+)['"]/g,
    /\bimport\s*['"]([^'"\n]+)['"]/g,
    /\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g
  ]
  for (const re of patterns) for (const m of code.matchAll(re)) out.add(m[1])
  return [...out]
}

/** tsconfig `paths` (already relative to the root, `./` stripped): `@shared/*` → [`src/shared/*`]. */
export type PathAliases = Record<string, string[]>

function normalize(path: string): string {
  const parts: string[] = []
  for (const p of path.split('/')) {
    if (!p || p === '.') continue
    if (p === '..') parts.pop()
    else parts.push(p)
  }
  return parts.join('/')
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

function lookup(base: string, files: Set<string>): string | null {
  if (files.has(base)) return base
  // `./x.js` written for a `.ts` file (NodeNext style)
  const stem = base.replace(/\.(m|c)?js$/, '')
  for (const e of RESOLVE_EXT) if (files.has(stem + e)) return stem + e
  for (const e of INDEX) if (files.has(base + e)) return base + e
  return null
}

/** The project file a specifier points at, or null for packages and anything unresolved. */
export function resolveImport(from: string, spec: string, files: Set<string>, aliases: PathAliases = {}): string | null {
  if (spec.startsWith('.')) return lookup(normalize(`${dirOf(from)}/${spec}`), files)
  for (const [pattern, targets] of Object.entries(aliases)) {
    const star = pattern.indexOf('*')
    const prefix = star < 0 ? pattern : pattern.slice(0, star)
    const suffix = star < 0 ? '' : pattern.slice(star + 1)
    const matches = star < 0 ? spec === pattern : spec.startsWith(prefix) && spec.endsWith(suffix) && spec.length >= prefix.length + suffix.length
    if (!matches) continue
    const rest = star < 0 ? '' : spec.slice(prefix.length, spec.length - suffix.length)
    for (const t of targets) {
      const hit = lookup(normalize(t.replace('*', rest)), files)
      if (hit) return hit
    }
  }
  return null
}

/** `paths` from a tsconfig's text (comments and trailing commas allowed), made root-relative. */
export function tsconfigAliases(text: string, configDir = ''): PathAliases {
  try {
    const json = JSON.parse(stripJsonComments(text).replace(/,\s*([}\]])/g, '$1')) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }
    const base = normalize(`${configDir}/${json.compilerOptions?.baseUrl ?? '.'}`)
    const out: PathAliases = {}
    for (const [k, v] of Object.entries(json.compilerOptions?.paths ?? {})) {
      if (Array.isArray(v)) out[k] = v.map((t) => normalize(`${base}/${t}`))
    }
    return out
  } catch {
    return {}
  }
}

function stripJsonComments(text: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      out += c
      if (c === '\\') out += text[++i] ?? ''
      else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
      out += c
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2)
      if (i < 0) break
      i++
    } else out += c
  }
  return out
}

/** The folder a file is grouped under at `depth` folder levels (a file in a shallower folder stays in it). */
export function groupOf(file: string, depth: number): string {
  const dirs = file.split('/').slice(0, -1)
  return dirs.length ? dirs.slice(0, depth).join('/') : '.'
}

/** File-level imports (file → resolved project files) collapsed to folders `depth` levels deep. */
export function folderGraph(imports: Record<string, string[]>, depth: number): Pick<CodeGraph, 'nodes' | 'edges'> {
  const files = new Map<string, number>()
  const edges = new Map<string, GraphEdge>()
  for (const f of Object.keys(imports)) {
    const g = groupOf(f, depth)
    files.set(g, (files.get(g) ?? 0) + 1)
  }
  for (const [f, targets] of Object.entries(imports)) {
    const from = groupOf(f, depth)
    for (const t of targets) {
      const to = groupOf(t, depth)
      if (to === from) continue
      if (!files.has(to)) files.set(to, 0)
      const key = `${from}\u0000${to}`
      const e = edges.get(key)
      if (e) e.count++
      else edges.set(key, { from, to, count: 1 })
    }
  }
  return {
    nodes: [...files].map(([id, n]) => ({ id, files: n })).sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  }
}

// ---------- schemas ----------

/** Comments become spaces, so offsets (and line numbers) still match the original text. */
function blank(c: string): string {
  return c.replace(/[^\n]/g, ' ')
}

function lineAt(text: string, index: number): number {
  let n = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

const PRISMA_SCALARS = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes', 'Unsupported'])

/** Models of a Prisma schema; relations come from `@relation(fields: […], references: […])`. */
export function parsePrisma(text: string, file: string): Pick<SchemaGraph, 'tables' | 'relations'> {
  const tables: Table[] = []
  const relations: Relation[] = []
  const src = text.replace(/\/\/.*$/gm, blank)
  const models = new Set([...src.matchAll(/\bmodel\s+(\w+)\s*\{/g)].map((m) => m[1]))
  const enums = new Set([...src.matchAll(/\b(?:enum|type)\s+(\w+)\s*\{/g)].map((m) => m[1]))
  for (const m of src.matchAll(/\bmodel\s+(\w+)\s*\{([^}]*)\}/g)) {
    const name = m[1]
    const columns: Column[] = []
    const blockPk = /@@id\s*\(\s*\[([^\]]*)\]/.exec(m[2])?.[1].split(',').map((s) => s.trim()) ?? []
    for (const raw of m[2].split('\n')) {
      const line = raw.trim()
      const f = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line)
      if (!f) continue
      const [, field, type, list, optional, rest] = f
      const rel = /@relation\s*\(([^)]*)\)/.exec(rest)?.[1]
      const fields = rel && /fields\s*:\s*\[([^\]]*)\]/.exec(rel)?.[1]
      const refs = rel && /references\s*:\s*\[([^\]]*)\]/.exec(rel)?.[1]
      if (fields && refs) {
        const split = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean)
        relations.push({ from: name, fromColumns: split(fields), to: type, toColumns: split(refs) })
      }
      // relation fields (another model, or a list of them, maybe from another schema file) aren't columns
      if (models.has(type) || (list && !PRISMA_SCALARS.has(type) && !enums.has(type))) continue
      columns.push({ name: field, type: list ? `${type}[]` : type, pk: /@id\b/.test(rest) || blockPk.includes(field), nullable: !!optional })
    }
    tables.push({ name, columns, file, line: lineAt(text, m.index) })
  }
  return { tables, relations }
}

function unquote(id: string): string {
  const s = id.trim().replace(/^[`"[]|[`"\]]$/g, '')
  // schema.table → table
  return s.split('.').pop()!.replace(/^[`"[]|[`"\]]$/g, '')
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const c of body) {
    if (c === '(') depth++
    else if (c === ')') depth--
    if (c === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += c
  }
  if (cur.trim()) parts.push(cur)
  return parts.map((p) => p.trim()).filter(Boolean)
}

function idList(s: string): string[] {
  return s.split(',').map(unquote).filter(Boolean)
}

const IDENT = String.raw`(?:[\`"\[]?[\w$]+[\`"\]]?\.)?[\`"\[]?[\w$]+[\`"\]]?`

/**
 * Tables of SQL DDL (`CREATE TABLE`, plus `ALTER TABLE … ADD … FOREIGN KEY`), in any common dialect.
 * Run over migrations in order, a later `CREATE TABLE` of the same name replaces the earlier one.
 */
export function parseSql(text: string, file: string): Pick<SchemaGraph, 'tables' | 'relations'> {
  const src = text.replace(/--.*$/gm, blank).replace(/\/\*[\s\S]*?\*\//g, blank)
  const tables: Table[] = []
  const relations: Relation[] = []
  const create = new RegExp(String.raw`\bcreate\s+(?:(?:global\s+|local\s+)?(?:temporary|temp)\s+)?table\s+(?:if\s+not\s+exists\s+)?(${IDENT})\s*\(`, 'gi')
  for (const m of src.matchAll(create)) {
    const name = unquote(m[1])
    // the body runs to the matching close paren
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    for (; i < src.length && depth; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') depth--
    }
    const columns: Column[] = []
    const pks = new Set<string>()
    for (const def of splitTopLevel(src.slice(start, i - 1))) {
      const pk = /^(?:constraint\s+\S+\s+)?primary\s+key\s*\(([^)]*)\)/i.exec(def)
      if (pk) {
        for (const c of idList(pk[1])) pks.add(c)
        continue
      }
      const fk = new RegExp(String.raw`^(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+(${IDENT})\s*(?:\(([^)]*)\))?`, 'i').exec(def)
      if (fk) {
        relations.push({ from: name, fromColumns: idList(fk[1]), to: unquote(fk[2]), toColumns: fk[3] ? idList(fk[3]) : [] })
        continue
      }
      if (/^(?:constraint|unique|check|index|key|exclude|fulltext|spatial)\b/i.test(def)) continue
      const col = new RegExp(String.raw`^([\`"\[]?[\w$]+[\`"\]]?)\s+([\w$]+(?:\s*\([^)]*\))?(?:\s+varying)?(?:\[\])?)(.*)$`, 'is').exec(def)
      if (!col) continue
      const colName = unquote(col[1])
      const rest = col[3]
      if (/\bprimary\s+key\b/i.test(rest)) pks.add(colName)
      columns.push({ name: colName, type: col[2].replace(/\s+/g, ' ').toLowerCase(), nullable: !/\bnot\s+null\b|\bprimary\s+key\b/i.test(rest) })
      const ref = new RegExp(String.raw`\breferences\s+(${IDENT})\s*(?:\(([^)]*)\))?`, 'i').exec(rest)
      if (ref) relations.push({ from: name, fromColumns: [colName], to: unquote(ref[1]), toColumns: ref[2] ? idList(ref[2]) : [] })
    }
    for (const c of columns) if (pks.has(c.name)) c.pk = true
    tables.push({ name, columns, file, line: lineAt(text, m.index) })
  }
  const alter = new RegExp(String.raw`\balter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(${IDENT})\s+add\s+(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+(${IDENT})\s*(?:\(([^)]*)\))?`, 'gi')
  for (const m of src.matchAll(alter)) {
    relations.push({ from: unquote(m[1]), fromColumns: idList(m[2]), to: unquote(m[3]), toColumns: m[4] ? idList(m[4]) : [] })
  }
  return { tables, relations }
}

/** Schema files merged in order: later tables replace earlier ones of the same name, relations are deduplicated. */
export function mergeSchemas(parts: Array<Pick<SchemaGraph, 'tables' | 'relations'>>, sources: string[]): SchemaGraph {
  const tables = new Map<string, Table>()
  const relations = new Map<string, Relation>()
  for (const p of parts) {
    for (const t of p.tables) tables.set(t.name.toLowerCase(), t)
    for (const r of p.relations) relations.set(`${r.from}|${r.fromColumns}|${r.to}`.toLowerCase(), r)
  }
  const known = (n: string): Table | undefined => tables.get(n.toLowerCase())
  return {
    tables: [...tables.values()].sort((a, b) => a.name.localeCompare(b.name)),
    // drop relations to tables we never saw (dropped later, or defined elsewhere), and use the tables' own spelling
    relations: [...relations.values()].filter((r) => known(r.from) && known(r.to)).map((r) => ({ ...r, from: known(r.from)!.name, to: known(r.to)!.name })),
    sources
  }
}

// ---------- layout ----------

export interface Placed {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * Layered layout for a directed graph: each node one layer right of what it depends on (cycles broken),
 * so dependencies sit to the right. Within a layer nodes are ordered by the average row of their
 * neighbours (one barycenter sweep each way), which keeps most edges short and uncrossed.
 */
export function layered(ids: string[], edges: Array<{ from: string; to: string }>, size: (id: string) => { w: number; h: number }, gap = { x: 80, y: 24 }): Placed[] {
  const out = new Map<string, string[]>()
  const inc = new Map<string, string[]>()
  for (const id of ids) {
    out.set(id, [])
    inc.set(id, [])
  }
  for (const e of edges) {
    if (e.from === e.to || !out.has(e.from) || !out.has(e.to)) continue
    out.get(e.from)!.push(e.to)
    inc.get(e.to)!.push(e.from)
  }
  // layer = longest path to a sink (dependencies on the right), with DFS cycle breaking
  const layer = new Map<string, number>()
  const onStack = new Set<string>()
  const depthOf = (id: string): number => {
    const known = layer.get(id)
    if (known !== undefined) return known
    onStack.add(id)
    let d = 0
    for (const t of out.get(id)!) if (!onStack.has(t)) d = Math.max(d, depthOf(t) + 1)
    onStack.delete(id)
    layer.set(id, d)
    return d
  }
  for (const id of ids) depthOf(id)
  const maxLayer = Math.max(0, ...layer.values())
  const columns: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  // leftmost column = the most dependent code
  for (const id of ids) columns[maxLayer - layer.get(id)!].push(id)
  const row = new Map<string, number>()
  const reindex = (col: string[]): void => col.forEach((id, i) => row.set(id, i))
  columns.forEach(reindex)
  const sweep = (col: string[], neighbours: Map<string, string[]>): void => {
    const score = (id: string): number => {
      const ns = neighbours.get(id)!.filter((n) => row.has(n))
      return ns.length ? ns.reduce((s, n) => s + row.get(n)!, 0) / ns.length : row.get(id)!
    }
    const scores = new Map(col.map((id) => [id, score(id)]))
    col.sort((a, b) => scores.get(a)! - scores.get(b)! || a.localeCompare(b))
    reindex(col)
  }
  for (let i = 1; i < columns.length; i++) sweep(columns[i], inc)
  for (let i = columns.length - 2; i >= 0; i--) sweep(columns[i], out)

  const placed: Placed[] = []
  let x = 0
  for (const col of columns) {
    const sizes = col.map(size)
    const width = Math.max(0, ...sizes.map((s) => s.w))
    let y = 0
    col.forEach((id, i) => {
      placed.push({ id, x, y, w: sizes[i].w, h: sizes[i].h })
      y += sizes[i].h + gap.y
    })
    x += width + gap.x
  }
  // centre each column vertically on the tallest
  const heights = columns.map((col) => placed.filter((p) => col.includes(p.id)).reduce((h, p) => Math.max(h, p.y + p.h), 0))
  const tallest = Math.max(0, ...heights)
  columns.forEach((col, i) => {
    const shift = (tallest - heights[i]) / 2
    for (const p of placed) if (col.includes(p.id)) p.y += shift
  })
  return placed
}

// ---------- export ----------

function mermaidId(s: string): string {
  return s.replace(/[^\w]/g, '_') || '_'
}

/** The import graph as a Mermaid flowchart, to paste into a PR or a doc. */
export function codeMermaid(g: Pick<CodeGraph, 'nodes' | 'edges'>): string {
  const lines = ['flowchart LR']
  for (const n of g.nodes) lines.push(`  ${mermaidId(n.id)}["${n.id.replace(/"/g, "'")}"]`)
  for (const e of g.edges) lines.push(`  ${mermaidId(e.from)} -->|${e.count}| ${mermaidId(e.to)}`)
  return lines.join('\n')
}

/** The schema as a Mermaid ER diagram (every foreign key drawn many-to-one). */
export function schemaMermaid(g: Pick<SchemaGraph, 'tables' | 'relations'>): string {
  const lines = ['erDiagram']
  for (const t of g.tables) {
    lines.push(`  ${mermaidId(t.name)} {`)
    for (const c of t.columns) lines.push(`    ${mermaidId(c.type.replace(/\s*\(.*$/, '')) || 'any'} ${mermaidId(c.name)}${c.pk ? ' PK' : ''}`)
    lines.push('  }')
  }
  for (const r of g.relations) lines.push(`  ${mermaidId(r.from)} }o--|| ${mermaidId(r.to)} : "${r.fromColumns.join(', ')}"`)
  return lines.join('\n')
}
