/**
 * The code map's languages: per language a small parser for its import lines and a resolver from an import to
 * project files, over an index built once per scan (Java packages, C# namespaces, Go modules, Python roots, Rust
 * crates, PHP psr-4 prefixes). Pure and forgiving like diagram.ts: stdlib and third-party imports resolve to
 * nothing and drop out, a rare false edge (an import in a Python docstring) is accepted.
 */
import { dirOf, normalize, parseImports, resolveImport, tsconfigAliases, type PathAliases } from './diagram'

export interface LangIndex {
  files: Set<string>
  /** folder → its files (any language) */
  byDir: Map<string, string[]>
  /** file name → files with that name, for C/C++ includes */
  byName: Map<string, string[]>
  aliases: PathAliases
  pythonRoots: string[]
  /** fully qualified class (package + file stem) → file, and package → files */
  jvmClasses: Map<string, string>
  jvmPackages: Map<string, string[]>
  csNamespaces: Map<string, string[]>
  /** module path → folder of its go.mod, longest module first */
  goModules: Array<{ module: string; dir: string }>
  /** folders holding a Cargo.toml, deepest first */
  cargoDirs: string[]
  /** psr-4 namespace prefix (with trailing `\`) → folder, longest prefix first */
  psr4: Array<{ prefix: string; dir: string }>
}

export interface Lang {
  id: string
  /** shown in the language filter and the subtitle */
  label: string
  ext: RegExp
  /** import specifiers as written (sometimes encoded, e.g. `mod:foo`), comments already ignored */
  parse(text: string): string[]
  /** project files an import points at; more than one when it stands for a package or namespace */
  resolve(from: string, spec: string, ctx: LangIndex): string[]
  /** facts the index needs from a file of this language */
  index?(file: string, text: string, ctx: LangIndex): void
}

// ---------- comments ----------

interface Syntax {
  line: string[]
  block?: [string, string]
  /** string delimiters; a string ends at its newline unless it is a triple-quoted Python one */
  quotes: string
  triple?: boolean
}

/** Comments become spaces (offsets and lines kept, like `blank()` in diagram.ts); strings are kept. */
export function stripComments(text: string, syntax: Syntax): string {
  let out = ''
  let i = 0
  const at = (s: string): boolean => text.startsWith(s, i)
  const blankTo = (end: number): void => {
    out += text.slice(i, end).replace(/[^\n]/g, ' ')
    i = end
  }
  while (i < text.length) {
    const c = text[i]
    if (syntax.triple && (at('"""') || at("'''"))) {
      const q = text.slice(i, i + 3)
      const end = text.indexOf(q, i + 3)
      const stop = end < 0 ? text.length : end + 3
      out += text.slice(i, stop)
      i = stop
    } else if (syntax.quotes.includes(c)) {
      let j = i + 1
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1
      const stop = Math.min(text.length, j + 1)
      out += text.slice(i, stop)
      i = stop
    } else if (syntax.line.some(at)) {
      const end = text.indexOf('\n', i)
      blankTo(end < 0 ? text.length : end)
    } else if (syntax.block && at(syntax.block[0])) {
      const end = text.indexOf(syntax.block[1], i + syntax.block[0].length)
      blankTo(end < 0 ? text.length : end + syntax.block[1].length)
    } else {
      out += c
      i++
    }
  }
  return out
}

const C_LIKE: Syntax = { line: ['//'], block: ['/*', '*/'], quotes: '"' }

function first(files: Set<string>, candidates: string[]): string[] {
  const hit = candidates.find((c) => files.has(c))
  return hit ? [hit] : []
}

function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join('/'))
}

function stemOf(file: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

/** The deepest of `dirs` that contains `file` ('' contains everything). */
function nearest(file: string, dirs: string[]): string | undefined {
  return dirs.find((d) => d === '' || file.startsWith(`${d}/`))
}

// ---------- languages ----------

const tsjs: Lang = {
  id: 'ts',
  label: 'TS/JS',
  ext: /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/,
  parse: parseImports,
  resolve: (from, spec, ctx) => {
    const hit = resolveImport(from, spec, ctx.files, ctx.aliases)
    return hit ? [hit] : []
  }
}

const python: Lang = {
  id: 'python',
  label: 'Python',
  ext: /\.pyi?$/,
  // `import a.b, c as d` → a.b, c; `from a.b import c, d` → a.b:c, a.b:d (c may be a submodule)
  parse(text) {
    const code = stripComments(text, { line: ['#'], quotes: `"'`, triple: true })
    const out = new Set<string>()
    for (const m of code.matchAll(/^[ \t]*import[ \t]+([\w. \t,]+)/gm)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+/)[0]
        if (name) out.add(name)
      }
    }
    for (const m of code.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n]*)/gm)) {
      for (const part of m[2].replace(/[()\\]/g, ' ').split(',')) {
        const name = part.trim().split(/\s+/)[0]
        if (name) out.add(`${m[1]}:${name}`)
      }
    }
    return [...out]
  },
  resolve(from, spec, ctx) {
    const [mod, name] = spec.split(':')
    const dots = /^\.*/.exec(mod)![0].length
    const path = mod.slice(dots).split('.').filter(Boolean).join('/')
    let bases: string[]
    if (dots) {
      let dir = dirOf(from)
      for (let i = 1; i < dots; i++) dir = dirOf(dir)
      bases = [join(dir, path)]
    } else bases = ctx.pythonRoots.map((r) => join(r, path))
    for (const base of bases) {
      const candidates = [
        ...(name && name !== '*' ? [join(base, `${name}.py`), join(base, name, '__init__.py')] : []),
        ...(path ? [`${base}.py`] : []),
        join(base, '__init__.py')
      ]
      const hit = first(ctx.files, candidates)
      if (hit.length) return hit
    }
    return []
  }
}

const jvm: Lang = {
  id: 'jvm',
  label: 'Java/Kotlin',
  ext: /\.(java|kt|kts|scala)$/,
  // `import a.b.C`, `import static a.b.C.m`, `import a.b.*`, Scala's `a.b._` and `a.b.{C, D => E}`
  parse(text) {
    const code = stripComments(text, C_LIKE)
    const out = new Set<string>()
    for (const m of code.matchAll(/^[ \t]*import[ \t]+(?:static[ \t]+)?([\w.]+?)(?:\.(\*|_)|\.\{([^}\n]*)\})?[ \t]*(?:[;\n]|\bas\b|$)/gm)) {
      if (m[3] !== undefined) {
        for (const part of m[3].split(',')) {
          const name = part.trim().split(/\s|=>/)[0]
          if (name === '_') out.add(`${m[1]}.*`)
          else if (name) out.add(`${m[1]}.${name}`)
        }
      } else out.add(m[2] ? `${m[1]}.*` : m[1])
    }
    return [...out]
  },
  resolve(_from, spec, ctx) {
    if (spec.endsWith('.*')) {
      const name = spec.slice(0, -2)
      const pkg = ctx.jvmPackages.get(name)
      if (pkg) return pkg
      const cls = ctx.jvmClasses.get(name)
      return cls ? [cls] : []
    }
    // a.b.C, or a static member / nested class of it: the longest prefix that is a class
    const parts = spec.split('.')
    for (let n = parts.length; n > 1; n--) {
      const cls = ctx.jvmClasses.get(parts.slice(0, n).join('.'))
      if (cls) return [cls]
    }
    return []
  },
  index(file, text, ctx) {
    const pkg = /^[ \t]*package[ \t]+([\w.]+)/m.exec(stripComments(text, C_LIKE))?.[1] ?? ''
    ctx.jvmClasses.set(pkg ? `${pkg}.${stemOf(file)}` : stemOf(file), file)
    push(ctx.jvmPackages, pkg, file)
  }
}

const go: Lang = {
  id: 'go',
  label: 'Go',
  ext: /\.go$/,
  parse(text) {
    const code = stripComments(text, { line: ['//'], block: ['/*', '*/'], quotes: '"`' })
    const out = new Set<string>()
    for (const m of code.matchAll(/\bimport\s*\(([^)]*)\)/g)) for (const q of m[1].matchAll(/"([^"\n]+)"/g)) out.add(q[1])
    for (const m of code.matchAll(/\bimport\s+(?:[\w.]+\s+)?"([^"\n]+)"/g)) out.add(m[1])
    return [...out]
  },
  resolve(_from, spec, ctx) {
    for (const { module, dir } of ctx.goModules) {
      if (spec !== module && !spec.startsWith(`${module}/`)) continue
      const target = join(dir, spec.slice(module.length))
      return (ctx.byDir.get(target) ?? []).filter((f) => f.endsWith('.go'))
    }
    return []
  }
}

const csharp: Lang = {
  id: 'csharp',
  label: 'C#',
  ext: /\.cs$/,
  parse(text) {
    const code = stripComments(text, C_LIKE)
    const out = new Set<string>()
    for (const m of code.matchAll(/^[ \t]*(?:global[ \t]+)?using[ \t]+(static[ \t]+)?(?:\w+[ \t]*=[ \t]*)?([\w.]+)[ \t]*;/gm)) out.add(m[1] ? `static:${m[2]}` : m[2])
    return [...out]
  },
  resolve(_from, spec, ctx) {
    if (spec.startsWith('static:')) {
      const name = spec.slice(7)
      return ctx.csNamespaces.get(name.slice(0, name.lastIndexOf('.'))) ?? []
    }
    return ctx.csNamespaces.get(spec) ?? []
  },
  index(file, text, ctx) {
    for (const m of stripComments(text, C_LIKE).matchAll(/\bnamespace\s+([\w.]+)\s*[{;]/g)) push(ctx.csNamespaces, m[1], file)
  }
}

/** The folder a Rust file's child modules live in: its own folder for crate roots and mod.rs, else <dir>/<stem>. */
function rustModDir(file: string): string {
  return /(^|\/)(lib|main|mod)\.rs$/.test(file) ? dirOf(file) : join(dirOf(file), stemOf(file))
}

function rustModule(base: string, segs: string[], files: Set<string>): string[] {
  for (let n = segs.length; n > 0; n--) {
    const path = join(base, ...segs.slice(0, n))
    const hit = first(files, [`${path}.rs`, join(path, 'mod.rs')])
    if (hit.length) return hit
  }
  return []
}

const rust: Lang = {
  id: 'rust',
  label: 'Rust',
  ext: /\.rs$/,
  // `mod foo;` → mod:foo; `use crate::a::{b, c::d}` → crate::a::b, crate::a::c::d
  parse(text) {
    const code = stripComments(text, { line: ['//'], block: ['/*', '*/'], quotes: '"' })
    const out = new Set<string>()
    for (const m of code.matchAll(/\bmod\s+(\w+)\s*;/g)) out.add(`mod:${m[1]}`)
    for (const m of code.matchAll(/\buse\s+((?:crate|super|self)(?:::\w+)*)(?:::\{([^}]*)\})?/g)) {
      if (m[2] === undefined) out.add(m[1])
      else for (const part of m[2].split(',')) {
        const name = part.trim().split(/\s|::\{/)[0]
        if (name && name !== 'self') out.add(`${m[1]}::${name}`)
        else if (name === 'self') out.add(m[1])
      }
    }
    return [...out]
  },
  resolve(from, spec, ctx) {
    if (spec.startsWith('mod:')) {
      const dir = rustModDir(from)
      return first(ctx.files, [join(dir, `${spec.slice(4)}.rs`), join(dir, spec.slice(4), 'mod.rs')])
    }
    const segs = spec.split('::')
    let base: string
    if (segs[0] === 'crate') {
      const cargo = nearest(from, ctx.cargoDirs)
      if (cargo === undefined) return []
      base = join(cargo, 'src')
      segs.shift()
      const hit = rustModule(base, segs, ctx.files)
      return hit.length ? hit : first(ctx.files, [join(base, 'lib.rs'), join(base, 'main.rs')])
    }
    base = rustModDir(from)
    if (segs[0] === 'self') segs.shift()
    while (segs[0] === 'super') {
      segs.shift()
      base = dirOf(base)
    }
    const hit = rustModule(base, segs, ctx.files)
    return hit.length ? hit : first(ctx.files, [`${base}.rs`, join(base, 'mod.rs'), join(base, 'lib.rs'), join(base, 'main.rs')])
  }
}

const cpp: Lang = {
  id: 'cpp',
  label: 'C/C++',
  ext: /\.(c|h|cc|cpp|cxx|hh|hpp|hxx)$/,
  parse(text) {
    const code = stripComments(text, C_LIKE)
    return [...new Set([...code.matchAll(/^[ \t]*#[ \t]*include[ \t]*"([^"\n]+)"/gm)].map((m) => m[1]))]
  },
  resolve(from, spec, ctx) {
    const local = join(dirOf(from), spec)
    if (ctx.files.has(local)) return [local]
    const tail = normalize(spec)
    const matches = (ctx.byName.get(tail.slice(tail.lastIndexOf('/') + 1)) ?? []).filter((f) => f === tail || f.endsWith(`/${tail}`))
    // a name that occurs twice is ambiguous: no edge rather than a wrong one
    return matches.length === 1 ? matches : []
  }
}

const ruby: Lang = {
  id: 'ruby',
  label: 'Ruby',
  ext: /\.rb$/,
  parse(text) {
    const code = stripComments(text, { line: ['#'], block: ['\n=begin', '\n=end'], quotes: `"'` })
    return [...new Set([...code.matchAll(/\brequire_relative\s*\(?\s*['"]([^'"\n]+)['"]/g)].map((m) => m[1]))]
  },
  resolve(from, spec, ctx) {
    const path = join(dirOf(from), spec)
    return first(ctx.files, [path, `${path}.rb`])
  }
}

const php: Lang = {
  id: 'php',
  label: 'PHP',
  ext: /\.php$/,
  // `use A\B\C;`, `use A\B, A\C;`, `use A\{B, C}`; require/include of literal paths → path:<literal>
  parse(text) {
    const code = stripComments(text, { line: ['//', '#'], block: ['/*', '*/'], quotes: `"'` })
    const out = new Set<string>()
    for (const m of code.matchAll(/^[ \t]*use[ \t]+(?:function[ \t]+|const[ \t]+)?([\w\\][^;]*);/gm)) {
      const group = /^([\w\\]*)\{([^}]*)\}/.exec(m[1].trim())
      const names = group ? group[2].split(',').map((p) => group[1] + p.trim()) : m[1].split(',').map((p) => p.trim())
      for (const n of names) {
        const name = n.split(/\s+as\s+/i)[0].trim().replace(/^\\/, '')
        if (/^[\w\\]+$/.test(name)) out.add(name)
      }
    }
    for (const m of code.matchAll(/\b(?:require|include)(?:_once)?\s*\(?\s*(?:__DIR__\s*\.\s*)?['"]([^'"\n]+\.php)['"]/g)) out.add(`path:${m[1]}`)
    return [...out]
  },
  resolve(from, spec, ctx) {
    if (spec.startsWith('path:')) return first(ctx.files, [join(dirOf(from), spec.slice(5))])
    for (const { prefix, dir } of ctx.psr4) {
      if (!spec.startsWith(prefix)) continue
      const hit = first(ctx.files, [join(dir, `${spec.slice(prefix.length).replace(/\\/g, '/')}.php`)])
      if (hit.length) return hit
    }
    return []
  }
}

/** The languages the code map reads imports of. Others are counted in the Files diagram only. */
export const LANGS: Lang[] = [tsjs, python, jvm, go, csharp, rust, cpp, ruby, php]

export function langOf(file: string): Lang | undefined {
  if (/\.d\.[mc]?ts$/.test(file)) return undefined
  return LANGS.find((l) => l.ext.test(file))
}

/** Build-system files the index reads (paths relative to the root). */
export const CONFIG_FILE = /(^|\/)(go\.mod|Cargo\.toml|composer\.json|pyproject\.toml|setup\.py|setup\.cfg|(tsconfig|jsconfig)[\w.-]*\.json)$/

/**
 * The index for resolving imports: every project file (`files`, any language), the texts of the mapped files read,
 * and the config files (go.mod, Cargo.toml, composer.json, pyproject.toml / setup.py, tsconfig) by path.
 */
export function buildIndex(files: string[], texts: Map<string, string>, configs: Map<string, string>): LangIndex {
  const ctx: LangIndex = {
    files: new Set(files),
    byDir: new Map(),
    byName: new Map(),
    aliases: {},
    pythonRoots: [],
    jvmClasses: new Map(),
    jvmPackages: new Map(),
    csNamespaces: new Map(),
    goModules: [],
    cargoDirs: [],
    psr4: []
  }
  for (const f of files) {
    push(ctx.byDir, dirOf(f), f)
    push(ctx.byName, f.slice(f.lastIndexOf('/') + 1), f)
  }
  const roots = new Set(['', 'src'])
  for (const [path, text] of configs) {
    const dir = dirOf(path)
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (name === 'go.mod') {
      const module = /^\s*module\s+(\S+)/m.exec(text)?.[1]
      if (module) ctx.goModules.push({ module: module.replace(/^"|"$/g, ''), dir })
    } else if (name === 'Cargo.toml') ctx.cargoDirs.push(dir)
    else if (name === 'composer.json') {
      try {
        const json = JSON.parse(text) as { autoload?: { 'psr-4'?: Record<string, string | string[]> }; 'autoload-dev'?: { 'psr-4'?: Record<string, string | string[]> } }
        for (const map of [json.autoload?.['psr-4'], json['autoload-dev']?.['psr-4']]) {
          for (const [prefix, target] of Object.entries(map ?? {})) {
            for (const t of Array.isArray(target) ? target : [target]) ctx.psr4.push({ prefix: prefix.replace(/^\\/, ''), dir: join(dir, t) })
          }
        }
      } catch {
        // not JSON: no psr-4 for this package
      }
    } else if (/^(pyproject\.toml|setup\.py|setup\.cfg)$/.test(name)) {
      roots.add(dir)
      roots.add(join(dir, 'src'))
    } else Object.assign(ctx.aliases, tsconfigAliases(text, dir))
  }
  ctx.pythonRoots = [...roots]
  ctx.goModules.sort((a, b) => b.module.length - a.module.length)
  ctx.cargoDirs.sort((a, b) => b.length - a.length)
  ctx.psr4.sort((a, b) => b.prefix.length - a.prefix.length)
  for (const [f, text] of texts) langOf(f)?.index?.(f, text, ctx)
  return ctx
}

/** Every mapped file's imports, resolved to project files (one entry per import, a list when it is a package). */
export function resolveAll(texts: Map<string, string>, ctx: LangIndex): Record<string, string[][]> {
  const out: Record<string, string[][]> = {}
  for (const [f, text] of texts) {
    const lang = langOf(f)
    if (!lang) continue
    out[f] = lang
      .parse(text)
      .map((spec) => lang.resolve(f, spec, ctx).filter((t) => t !== f))
      .filter((t) => t.length)
  }
  return out
}
