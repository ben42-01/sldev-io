import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path'

/**
 * Where a new tab opens: the TUI's New tab popup lists projects (the ones tabs work in, then recent ones) and
 * browses folders, so moving to another project doesn't mean quitting and running sldev from there. Recent
 * projects are kept in `<data>/projects.json`; a folder that's gone drops out.
 */

const RECENT_MAX = 12

const recentPath = (dataDir: string): string => join(dataDir, 'projects.json')

export function readRecent(dataDir: string): string[] {
  if (!dataDir) return []
  try {
    const raw = JSON.parse(readFileSync(recentPath(dataDir), 'utf8')) as { recent?: unknown }
    return Array.isArray(raw.recent) ? raw.recent.filter((p): p is string => typeof p === 'string' && isAbsolute(p)) : []
  } catch {
    return []
  }
}

/** `dir` goes to the front of the recent projects; nothing is written without a data folder (tests) */
export function rememberProject(dataDir: string, dir: string): void {
  if (!dataDir || !dir) return
  const recent = [dir, ...readRecent(dataDir).filter((p) => p !== dir)].slice(0, RECENT_MAX)
  try {
    const file = recentPath(dataDir)
    writeFileSync(file + '.tmp', JSON.stringify({ recent }))
    renameSync(file + '.tmp', file)
  } catch {
    // not remembered: the list is a convenience
  }
}

export const isFolder = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * The projects to offer: those open tabs work in (in tab order), then recent ones, without repeats or
 * folders that are gone, at most `max`.
 */
export function projectList(open: string[], recent: string[], max = 6, exists: (p: string) => boolean = isFolder): string[] {
  const out: string[] = []
  for (const p of [...open, ...recent]) {
    if (out.length >= max) break
    if (p && !out.includes(p) && exists(p)) out.push(p)
  }
  return out
}

export interface Folder {
  name: string
  path: string
  /** a git repository (it has .git): likely a project */
  git: boolean
}

/** The folders in `dir`, hidden ones left out, sorted by name; unreadable means none. */
export function subfolders(dir: string, max = 300): Folder[] {
  let entries: import('fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => !e.name.startsWith('.') && (e.isDirectory() || (e.isSymbolicLink() && isFolder(join(dir, e.name)))))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .slice(0, max)
    .map((name) => ({ name, path: join(dir, name), git: existsSync(join(dir, name, '.git')) }))
}

/** The folder above `dir`, or null at the top (/ or a drive's root). */
export function parentFolder(dir: string): string | null {
  const up = dirname(dir)
  return up === dir ? null : up
}

/** A typed path as a folder: `~` is the home folder, a relative one is taken from `base`. */
export function expandPath(text: string, base: string, home = homedir()): string {
  const t = text.trim()
  if (t === '~') return home
  if (t.startsWith('~/') || t.startsWith('~\\')) return join(home, t.slice(2))
  return resolve(base, t)
}

/**
 * Tab in the folder prompt: the typed path completed as far as the folders it can be agree, with a separator
 * once it names exactly one. Unchanged when nothing matches.
 */
export function completePath(text: string, base: string, home = homedir()): string {
  const endsSep = /[\\/]$/.test(text)
  const full = text.trim() ? expandPath(text, base, home) : base
  const dir = endsSep || !text.trim() ? full : dirname(full)
  const part = endsSep || !text.trim() ? '' : basename(full)
  const names = subfolders(dir)
    .map((f) => f.name)
    .filter((n) => n.toLowerCase().startsWith(part.toLowerCase()))
  if (!names.length) return text
  let common = names[0]
  for (const n of names.slice(1)) {
    let i = 0
    while (i < common.length && i < n.length && common[i].toLowerCase() === n[i].toLowerCase()) i++
    common = common.slice(0, i)
  }
  if (common.length < part.length) return text
  // keep what was typed before the last part (a ~ stays a ~)
  const head = endsSep || !text.trim() ? text : text.slice(0, text.length - basename(text.replace(/[\\/]+$/, '')).length)
  return head + common + (names.length === 1 ? sep : '')
}
