import { existsSync, promises as fsp } from 'fs'
import { join, relative, resolve, sep } from 'path'
import type { RuntimeDef } from '@shared/types'
import { detectRuntimes } from '../../src/main/runtimes'
import { CLI_DIR, ensureCliFolder } from './briefs'

/**
 * Runtimes: named commands of a project, run in a shell tab of their own (`ls -lrt`, `npm run dev`, a deploy
 * script). The ones you add are kept in `.sldev-cli/runtimes.json` at the project's main checkout (git-ignored
 * with the rest of the CLI's folder); the project's own scripts (package.json, Makefile, justfile, Cargo…) are
 * found by the app's detector and listed after them. Starting one opens a shell in its folder and types the
 * command there, so when it ends the tab is a shell you can run it again in, and a restored tab (after a
 * reboot) is only a shell: nothing runs again on its own.
 */

export interface SavedRuntime {
  name: string
  command: string
  /** relative to the project, '' (or missing) for its top level */
  cwd?: string
}

/** A runtime as a list shows it: one you added, or one the project's files define. */
export interface Runtime {
  name: string
  command: string
  /** absolute */
  cwd: string
  saved: boolean
  /** where a detected one came from (`package.json`, `web/Makefile`) */
  group?: string
  /** a script's body, when it isn't the command itself */
  detail?: string
}

export const runtimesFile = (root: string): string => join(root, CLI_DIR, 'runtimes.json')

/** the names a runtime may have: something you can type after `sldev runtime start` */
const NAME = /^[\w][\w.:@/+-]{0,59}$/

export function checkName(name: string): string | null {
  if (!name.trim()) return 'A runtime needs a name'
  if (!NAME.test(name.trim())) return `"${name.trim()}" can't be a runtime name: use letters, digits and . _ - : @ / + (no spaces), at most 60`
  return null
}

/** A name from a command: its first word that isn't a runner (`npm run dev` → dev, `ls -lrt` → ls). */
export function nameFrom(command: string): string {
  const words = command.trim().split(/\s+/).filter((w) => !w.startsWith('-'))
  const skip = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'run', 'exec', 'make', 'just', 'cargo', 'go', 'uv', 'poetry', 'deno', 'task', 'sudo'])
  const word = words.find((w) => !skip.has(w)) ?? words[0] ?? 'runtime'
  const clean = word.replace(/^.*[\\/]/, '').replace(/[^\w.:@+-]/g, '').slice(0, 60)
  return clean || 'runtime'
}

/** The saved runtimes; a missing file is none, a broken one is an error that says where. */
export async function readSaved(root: string): Promise<SavedRuntime[]> {
  const file = runtimesFile(root)
  let text: string
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch {
    return []
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new Error(`${file} isn't valid JSON (${(e as Error).message}); fix or remove it`)
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { runtimes?: unknown }).runtimes) ? (raw as { runtimes: unknown[] }).runtimes : []
  return list.flatMap((r): SavedRuntime[] => {
    if (!r || typeof r !== 'object') return []
    const { name, command, cwd } = r as Record<string, unknown>
    if (typeof name !== 'string' || typeof command !== 'string' || !command.trim() || checkName(name)) return []
    return [{ name: name.trim(), command, ...(typeof cwd === 'string' && cwd ? { cwd } : {}) }]
  })
}

async function writeSaved(root: string, list: SavedRuntime[]): Promise<void> {
  await ensureCliFolder(root)
  const file = runtimesFile(root)
  await fsp.writeFile(file + '.tmp', JSON.stringify({ runtimes: list }, null, 2) + '\n')
  await fsp.rename(file + '.tmp', file)
}

/** Adds a runtime, or replaces the one with its name; `cwd` (absolute) is kept relative to the project. */
export async function addRuntime(root: string, r: { name: string; command: string; cwd?: string }): Promise<{ replaced: boolean; runtime: SavedRuntime }> {
  const problem = checkName(r.name)
  if (problem) throw new Error(problem)
  if (!r.command.trim()) throw new Error('A runtime needs a command')
  if (/[\r\n]/.test(r.command.trim())) throw new Error('A runtime is one line: put several commands in a script, or join them with &&')
  const rel = r.cwd ? relative(root, resolve(r.cwd)).split(sep).join('/') : ''
  if (rel.startsWith('..')) throw new Error(`${r.cwd} isn't inside the project ${root}`)
  const runtime: SavedRuntime = { name: r.name.trim(), command: r.command.trim(), ...(rel ? { cwd: rel } : {}) }
  const list = await readSaved(root)
  const at = list.findIndex((x) => x.name === runtime.name)
  if (at >= 0) list[at] = runtime
  else list.push(runtime)
  await writeSaved(root, list)
  return { replaced: at >= 0, runtime }
}

export async function removeRuntime(root: string, name: string): Promise<boolean> {
  const list = await readSaved(root)
  const left = list.filter((x) => x.name !== name)
  if (left.length === list.length) return false
  await writeSaved(root, left)
  return true
}

const fromSaved = (root: string, r: SavedRuntime): Runtime => ({ name: r.name, command: r.command, cwd: r.cwd ? resolve(root, r.cwd) : root, saved: true })

const fromDetected = (d: RuntimeDef): Runtime => ({ name: d.name, command: d.command, cwd: d.cwd, saved: false, group: d.group, ...(d.detail && d.detail !== d.command ? { detail: d.detail } : {}) })

/** Saved ones first, in the order they were added, then what the project's files define. */
export async function listRuntimes(root: string, detect: (root: string) => Promise<RuntimeDef[]> = detectRuntimes): Promise<Runtime[]> {
  const saved = (await readSaved(root)).map((r) => fromSaved(root, r))
  const found = existsSync(root) ? await detect(root).catch(() => []) : []
  return [...saved, ...found.map(fromDetected)]
}

/**
 * The runtime `name` means: a saved one, else a detected one by its name, or `group:name` / `dir/name` when
 * two folders have the same script (`web/package.json:dev` or `web:dev`).
 */
export function findRuntime(list: Runtime[], name: string): Runtime | undefined {
  const saved = list.find((r) => r.saved && r.name === name)
  if (saved) return saved
  const byName = list.filter((r) => !r.saved && r.name === name)
  if (byName.length === 1) return byName[0]
  const m = /^(.+):([^:]+)$/.exec(name)
  if (!m) return byName[0]
  return list.find((r) => !r.saved && r.name === m[2] && (r.group === m[1] || r.group?.replace(/\/[^/]+$/, '') === m[1]))
}
