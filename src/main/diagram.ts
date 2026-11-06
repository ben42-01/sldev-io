import { promises as fsp } from 'fs'
import { join } from 'path'
import * as git from './git'
import { walkFiles } from './fs'
import { CODE_EXT, folderGraph, mergeSchemas, parseImports, parsePrisma, parseSql, resolveImport, tsconfigAliases, type CodeGraph, type PathAliases, type SchemaGraph } from '@shared/diagram'

const MAX_FILES = 4000
const MAX_BYTES = 512 * 1024
const SKIP = /(^|\/)(node_modules|dist|out|build|coverage|vendor|\.next|\.turbo)\//
const DECLARATION = /\.d\.[mc]?ts$/

async function projectFiles(root: string): Promise<string[]> {
  const files = (await git.isRepo(root)) ? await git.listFiles(root) : await walkFiles(root)
  return files.filter((f) => !SKIP.test(f))
}

async function readSmall(path: string): Promise<string | null> {
  try {
    const st = await fsp.stat(path)
    return st.isFile() && st.size <= MAX_BYTES ? await fsp.readFile(path, 'utf8') : null
  } catch {
    return null
  }
}

/** In chunks, so a big repo doesn't open thousands of files at once. */
async function readAll(root: string, files: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < files.length; i += 64) {
    const chunk = files.slice(i, i + 64)
    const texts = await Promise.all(chunk.map((f) => readSmall(join(root, f))))
    chunk.forEach((f, j) => texts[j] !== null && out.set(f, texts[j]!))
  }
  return out
}

async function aliases(root: string, files: string[]): Promise<PathAliases> {
  const configs = files.filter((f) => /(^|\/)(tsconfig|jsconfig)[\w.-]*\.json$/.test(f)).slice(0, 20)
  const out: PathAliases = {}
  for (const c of configs) {
    const text = await readSmall(join(root, c))
    if (text) Object.assign(out, tsconfigAliases(text, c.includes('/') ? c.slice(0, c.lastIndexOf('/')) : ''))
  }
  return out
}

/** TS/JS imports between project files, grouped into folders `depth` levels deep. */
export async function codeGraph(root: string, depth: number): Promise<CodeGraph> {
  const all = await projectFiles(root)
  const code = all.filter((f) => CODE_EXT.test(f) && !DECLARATION.test(f))
  const picked = code.slice(0, MAX_FILES)
  const set = new Set(picked)
  const [texts, paths] = await Promise.all([readAll(root, picked), aliases(root, all)])
  const imports: Record<string, string[]> = {}
  for (const [f, text] of texts) {
    imports[f] = parseImports(text)
      .map((s) => resolveImport(f, s, set, paths))
      .filter((t): t is string => !!t && t !== f)
  }
  return { ...folderGraph(imports, Math.max(1, Math.min(8, Math.floor(depth)))), scanned: texts.size, truncated: code.length > MAX_FILES }
}

/** Prisma schemas and SQL DDL (migrations in path order, so later ones win). */
export async function schemaGraph(root: string): Promise<SchemaGraph> {
  const all = await projectFiles(root)
  const sources = all
    .filter((f) => /\.prisma$/.test(f) || /\.sql$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, 2000)
  const texts = await readAll(root, sources)
  const parts = [...texts].map(([f, text]) => (f.endsWith('.prisma') ? parsePrisma(text, f) : parseSql(text, f)))
  const used = [...texts.keys()].filter((_, i) => parts[i].tables.length || parts[i].relations.length)
  return mergeSchemas(parts, used)
}
