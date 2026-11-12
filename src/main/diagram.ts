import { promises as fsp } from 'fs'
import { join } from 'path'
import * as git from './git'
import { walkFiles } from './fs'
import { folderGraph, mergeSchemas, parsePrisma, parseSql, structureGraph, type CodeGraph, type SchemaGraph, type StructureGraph } from '@shared/diagram'
import { buildIndex, CONFIG_FILE, langOf, LANGS, resolveAll } from '@shared/diagramLangs'

const MAX_FILES = 4000
const MAX_BYTES = 512 * 1024
const SKIP = /(^|\/)(node_modules|dist|out|build|coverage|vendor|\.next|\.turbo|target|obj|__pycache__|\.venv|venv|\.gradle|Pods|bin\/Debug|bin\/Release)\//

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

function clampDepth(depth: number): number {
  return Math.max(1, Math.min(8, Math.floor(depth) || 2))
}

/**
 * Imports between project files in every mapped language (or only `language`, a code map lang id), grouped into
 * folders `depth` levels deep. One read pass over at most MAX_FILES files, plus the build files the index needs.
 */
export async function codeGraph(root: string, depth: number, language?: string): Promise<CodeGraph> {
  const all = await projectFiles(root)
  const mapped = all.filter((f) => langOf(f))
  const languages: Record<string, number> = {}
  for (const f of mapped) {
    const label = langOf(f)!.label
    languages[label] = (languages[label] ?? 0) + 1
  }
  const lang = LANGS.find((l) => l.id === language)
  const code = lang ? mapped.filter((f) => langOf(f) === lang) : mapped
  const picked = code.slice(0, MAX_FILES)
  const [texts, configs] = await Promise.all([readAll(root, picked), readAll(root, all.filter((f) => CONFIG_FILE.test(f)).slice(0, 200))])
  const imports = resolveAll(texts, buildIndex(all, texts, configs))
  return { ...folderGraph(imports, clampDepth(depth)), scanned: texts.size, truncated: code.length > MAX_FILES, languages }
}

/** Folders and source files of any language, `depth` levels deep; listing only, nothing is read. */
export async function structure(root: string, depth: number): Promise<StructureGraph> {
  return structureGraph(await projectFiles(root), clampDepth(depth))
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
