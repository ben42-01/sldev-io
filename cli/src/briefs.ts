import { existsSync, promises as fsp, statSync } from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { branchName } from '@shared/branch'
import { BUILTIN_KINDS, kindSlug, type MissionKind } from '@shared/missionKinds'
import { parseMissionDraft, type MissionDraft } from '@shared/sldevSkills'
import { run } from '../../src/main/git'
import { listKinds } from '../../src/main/missionKinds'
import type { Client } from './client'
import type { NewPaneArgs, PaneInfo } from './protocol'

/**
 * The CLI's own folder in a project, `.sldev-cli/` at the main checkout's top level: briefs written ahead
 * of time (`briefs/*.md`, launched ones in `briefs/launched/`) and the CLI's project mission kinds
 * (`kinds/*.md`). It is separate from `.sldev/drafts`, which only the app takes in, and the app never reads
 * it. A brief has a mission draft's front matter (title, kind, agent, criteria, worktree, by) and the brief
 * as its body, read by the same parser. Nothing here launches on its own: `sldev launch` or Enter in the
 * TUI's picker does.
 */

export const CLI_DIR = '.sldev-cli'

export const cliFolder = (root: string): string => join(root, CLI_DIR)
export const briefsDir = (root: string): string => join(root, CLI_DIR, 'briefs')
export const launchedDir = (root: string): string => join(root, CLI_DIR, 'briefs', 'launched')
export const cliKindsDir = (root: string): string => join(root, CLI_DIR, 'kinds')

const GITIGNORE = '# sldev CLI: briefs and kinds stay out of git. Remove this file (or a line) to share them.\n*\n'

/** The project a folder belongs to: the main checkout's top level (also from inside a worktree), else the folder. */
export async function cliRoot(cwd: string): Promise<string> {
  const common = await run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)
  const dir = common.code === 0 ? common.stdout.trim() : ''
  // a normal repo or worktree: <main>/.git; a submodule or bare repo is left to its own top level
  if (dir && basename(dir) === '.git') return resolve(dirname(dir))
  const top = await run('git', ['rev-parse', '--show-toplevel'], cwd)
  return top.code === 0 && top.stdout.trim() ? resolve(top.stdout.trim()) : resolve(cwd)
}

/** Creates `.sldev-cli/` with its .gitignore (only when it has none, so a user's change stays) and the briefs folder. */
export async function ensureCliFolder(root: string): Promise<void> {
  await fsp.mkdir(briefsDir(root), { recursive: true })
  const ignore = join(cliFolder(root), '.gitignore')
  if (!existsSync(ignore)) await fsp.writeFile(ignore, GITIGNORE)
}

/** Mission kinds for the CLI: the built-in ones, the project's `.sldev-cli/kinds`, then the user's. */
export async function cliKinds(root: string, dataDir: string): Promise<MissionKind[]> {
  return [...BUILTIN_KINDS, ...(await listKinds(root, dataDir, cliKindsDir(root)))]
}

export interface Brief {
  file: string
  /** the file name without .md: what `sldev launch <slug>` takes */
  slug: string
  draft?: MissionDraft
  /** why it can't launch */
  error?: string
  warning?: string
}

/** what a brief's `kind:` can say: a built-in kind's id, a custom kind's name (its id is its file path), lower case */
const kindKeys = (kinds: MissionKind[]): string[] => [...new Set(kinds.map((k) => (k.scope === 'builtin' ? k.id : k.name.toLowerCase())))]

/** A brief file's text as a mission: the draft parser, with the CLI's kinds; an unknown kind is refused, not made a build. */
export function readBrief(file: string, src: string, kinds: MissionKind[]): Brief {
  const slug = basename(file).replace(/\.md$/i, '')
  const keys = kindKeys(kinds)
  const r = parseMissionDraft(src, keys)
  if (r.error) return { file, slug, error: r.error }
  if (r.unknownKind) return { file, slug, error: `Unknown kind "${r.unknownKind}". Known: ${keys.join(', ')}` }
  if (r.draft?.criteria && r.draft.kind === 'freeform') return { file, slug, error: 'A freeform brief goes exactly as written, so it has no acceptance criteria: pick another kind or drop the criteria' }
  return { file, slug, draft: r.draft, ...(r.warning ? { warning: r.warning } : {}) }
}

/** The briefs waiting in `.sldev-cli/briefs`, by name; files starting with a dot (one being written) are left out. */
export async function listBriefs(root: string, kinds: MissionKind[]): Promise<Brief[]> {
  const dir = briefsDir(root)
  const names = (await fsp.readdir(dir, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isFile() && d.name.endsWith('.md') && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort()
  return Promise.all(names.map(async (n) => readBrief(join(dir, n), await fsp.readFile(join(dir, n), 'utf8'), kinds)))
}

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

const inside = (dir: string, file: string): boolean => {
  const r = relative(dir, file)
  return !!r && !r.startsWith('..') && !isAbsolute(r)
}

/** A brief by path (relative to `cwd`) or by slug in the project's briefs folder. */
export function findBrief(root: string, ref: string, cwd: string): string {
  const asPath = resolve(cwd, ref)
  const bySlug = join(briefsDir(root), ref.endsWith('.md') ? basename(ref) : `${basename(ref)}.md`)
  const file = isFile(asPath) ? asPath : isFile(bySlug) ? bySlug : null
  if (!file) throw new Error(`No brief "${ref}" in ${relative(cwd, briefsDir(root)) || briefsDir(root)}. See sldev briefs.`)
  if (inside(launchedDir(root), file)) throw new Error(`${basename(file)} was launched already; copy it back to ${CLI_DIR}/briefs to run it again`)
  return file
}

/** What `sldev new` would be asked for: the brief's kind, agent (unless one is given), criteria and worktree. */
export function briefArgs(d: MissionDraft, o: { cwd: string; agent?: string; cols?: number; rows?: number }): NewPaneArgs {
  return {
    agent: o.agent ?? d.agent,
    brief: d.brief,
    title: d.title,
    kind: d.kind,
    criteria: d.criteria,
    // true: a worktree named after the brief; false: in place; left out: as the kind says
    worktree: d.worktree === true ? branchName(d.title || d.brief) : d.worktree,
    cwd: o.cwd,
    cols: o.cols,
    rows: o.rows
  }
}

/** The brief's text with the pane it started in and when, in its front matter (one is added when it has none). */
export function withLaunch(src: string, pane: string, at: Date): string {
  const lines = `pane: "${pane}"\nlaunched: "${at.toISOString()}"`
  const m = /^(﻿?---\r?\n[\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/.exec(src)
  if (m) return `${m[1]}\n${lines}${m[2]}${src.slice(m[0].length)}`
  return `---\n${lines}\n---\n\n${src}`
}

/** Moves a launched brief to `briefs/launched/` (never over another one) with its pane noted; returns where it went. */
export async function markLaunched(root: string, file: string, pane: string, at = new Date()): Promise<string> {
  const dir = launchedDir(root)
  await ensureCliFolder(root)
  await fsp.mkdir(dir, { recursive: true })
  const name = basename(file).replace(/\.md$/i, '')
  let to = join(dir, `${name}.md`)
  for (let i = 2; existsSync(to); i++) to = join(dir, `${name}-${i}.md`)
  await fsp.writeFile(to, withLaunch(await fsp.readFile(file, 'utf8'), pane, at))
  await fsp.unlink(file)
  return to
}

export interface Launched {
  pane: PaneInfo
  /** where the brief went */
  moved: string
  warning?: string
}

/**
 * Starts a brief as `sldev new` would and moves it to launched/. A brief that doesn't read, or that the
 * daemon refuses (an agent that isn't installed, a kind it doesn't know), throws with the reason and stays.
 */
export async function launchBrief(client: Client, root: string, file: string, kinds: MissionKind[], o: { cwd: string; agent?: string; cols?: number; rows?: number }): Promise<Launched> {
  const b = readBrief(file, await fsp.readFile(file, 'utf8'), kinds)
  if (!b.draft) throw new Error(`${b.slug}: ${b.error}. It stays in ${CLI_DIR}/briefs.`)
  let pane: PaneInfo
  try {
    pane = await client.request('new', briefArgs(b.draft, o))
  } catch (e) {
    throw new Error(`${b.slug}: ${(e as Error).message}. It stays in ${CLI_DIR}/briefs.`)
  }
  return { pane, moved: await markLaunched(root, file, pane.id), ...(b.warning ? { warning: b.warning } : {}) }
}

/** One line per brief for `sldev briefs` and the picker: title, kind, agent, or why it can't launch. */
export function briefNote(b: Brief): string {
  if (!b.draft) return `can't launch: ${b.error}`
  const d = b.draft
  return [d.kind, d.agent, d.worktree === true ? 'worktree' : d.worktree === false ? 'in place' : '', d.criteria ? `${d.criteria.split('\n').length} criteria` : '', d.by ? `by ${d.by}` : ''].filter(Boolean).join(' · ')
}

export const briefTitle = (b: Brief): string => b.draft?.title || b.draft?.brief.split('\n')[0].slice(0, 60) || b.slug

// ── a brief written in $EDITOR (Ctrl-b c) ─────────────────────────────

const HELP_START = '<!-- sldev:'
const HELP = `${HELP_START} write the brief under the front matter, then save and close the editor to start it.
     Leave the brief empty to start nothing. criteria: one "- " line each; worktree: true runs it in a new
     git worktree. This comment is removed. -->`

/** A brief template, with the agent picked, in a dot-file the briefs list doesn't show while it's being written. */
export async function newBriefFile(root: string, agent: string, at = new Date()): Promise<string> {
  await ensureCliFolder(root)
  const file = join(briefsDir(root), `.new-${at.getTime()}.md`)
  await fsp.writeFile(file, `---\ntitle: \nkind: build\nagent: ${agent}\nworktree: false\ncriteria:\n  - \n---\n\n${HELP}\n\n`)
  return file
}

/**
 * The template after the editor closed: null when the brief was left empty (the file is removed, like an empty
 * `git commit` message), else the brief saved as `<slug>.md` in the briefs folder, so it waits there if it can't
 * launch.
 */
export async function takeEditedBrief(root: string, file: string): Promise<string | null> {
  const src = (await fsp.readFile(file, 'utf8').catch(() => ''))
    .split(HELP)
    .join('')
    .replace(new RegExp(`${HELP_START}[\\s\\S]*?-->`), '')
  const r = parseMissionDraft(src, [])
  if (!r.draft) {
    if (/empty/.test(r.error ?? '') || !src.trim()) {
      await fsp.rm(file, { force: true })
      return null
    }
  }
  const slug = kindSlug(r.draft?.title || r.draft?.brief.split('\n')[0] || 'brief')
  let to = join(briefsDir(root), `${slug}.md`)
  for (let i = 2; existsSync(to); i++) to = join(briefsDir(root), `${slug}-${i}.md`)
  await fsp.writeFile(to, src.replace(/\n{3,}/g, '\n\n'))
  await fsp.rm(file, { force: true })
  return to
}

/** the briefs folder as the user sees it from `cwd` */
export const shownDir = (root: string, cwd: string): string => {
  const r = relative(cwd, briefsDir(root))
  return r && !r.startsWith('..') ? r : briefsDir(root).split(sep).join('/')
}
