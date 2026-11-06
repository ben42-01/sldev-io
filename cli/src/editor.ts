import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { EditorInfo, Mission } from '@shared/types'
import { detectEditors, openDiffInEditor, openInEditor, terminalEditorCommand } from '../../src/main/editors'
import { run } from '../../src/main/git'

/**
 * `sldev open` and the TUI's Ctrl-b e / v: a pane's folder, or its changed files side by side, in the
 * user's editor. Which one: --editor, then the app's preferred editor (Settings), then the first found
 * (Cursor, VS Code, Windsurf, Zed, …; src/main/editors.ts).
 */

/** The editor to use: one asked for, else the preferred one if it's installed, else the first GUI editor, else a terminal one. */
export function pickEditor(found: EditorInfo[], wanted?: string | null, preferred?: string | null): EditorInfo | undefined {
  if (wanted) return found.find((e) => e.id === wanted || e.name.toLowerCase() === wanted.toLowerCase())
  return found.find((e) => e.id === preferred) ?? found.find((e) => e.kind === 'gui') ?? found[0]
}

/** The files a pane changed since its base: committed, staged, unstaged and new ones, without deletions. */
export async function changedFiles(cwd: string, base: string): Promise<string[]> {
  const mergeBase = (await run('git', ['merge-base', base, 'HEAD'], cwd)).stdout.trim() || base
  const tracked = (await run('git', ['diff', '--name-only', '--diff-filter=d', mergeBase], cwd)).stdout.split('\n')
  const untracked = (await run('git', ['ls-files', '--others', '--exclude-standard'], cwd)).stdout.split('\n')
  return [...new Set([...tracked, ...untracked].map((f) => f.trim()).filter(Boolean))]
}

/** at most this many diff tabs: past that, the folder (and the editor's own source control view) says more */
export const MAX_DIFFS = 12

export interface OpenResult {
  /** what happened, one line */
  note: string
  /** a terminal editor to run in the foreground (sldev open only; the TUI can't hand its screen over) */
  terminal?: string[]
}

export async function openPane(p: Pick<Mission, 'cwd' | 'worktree' | 'baseCommit'>, o: { diff?: boolean; editor?: string; preferred?: string | null }): Promise<OpenResult> {
  const found = await detectEditors()
  const e = pickEditor(found, o.editor, o.preferred)
  if (!e) {
    if (o.editor) throw new Error(`No editor "${o.editor}" found. Found: ${found.map((x) => x.id).join(', ') || 'none'}`)
    throw new Error('No editor found on PATH (Cursor, VS Code, Windsurf, Zed, Sublime, JetBrains, Neovim, Helix, Vim)')
  }
  if (e.kind === 'terminal') {
    const bin = terminalEditorCommand(e.id)
    return { note: `Opening ${p.cwd} in ${e.name}`, terminal: bin ? [bin, p.cwd] : undefined }
  }
  const base = p.worktree?.base ?? p.baseCommit
  if (o.diff && base && e.canDiff) {
    const files = await changedFiles(p.cwd, base)
    if (!files.length) {
      openInEditor(e.id, p.cwd)
      return { note: `No changes yet; opened the folder in ${e.name}` }
    }
    // the folder first, so the diff tabs open in that window
    openInEditor(e.id, p.cwd)
    for (const f of files.slice(0, MAX_DIFFS)) await openDiffInEditor(e.id, p.cwd, base, f)
    const more = files.length > MAX_DIFFS ? ` (the first ${MAX_DIFFS} of ${files.length}; the rest are in its source control view)` : ''
    return { note: `Opened ${Math.min(files.length, MAX_DIFFS)} changed file${files.length === 1 ? '' : 's'} side by side in ${e.name}${more}` }
  }
  openInEditor(e.id, p.cwd)
  const why = o.diff && !e.canDiff ? ` (${e.name} can't open a diff from the command line, so the folder)` : ''
  return { note: `Opened ${p.cwd} in ${e.name}${why}` }
}

/** Runs a terminal editor in this terminal until it exits. */
export function runTerminalEditor(argv: string[], cwd: string): void {
  spawnSync(argv[0], argv.slice(1), { cwd, stdio: 'inherit' })
}

/** The editor picked in the app (Settings → Editor), shared through its data folder; null when none is set. */
export function preferredEditor(dataDir: string): string | null {
  try {
    return (JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8')) as { preferredEditor?: string | null }).preferredEditor ?? null
  } catch {
    return null
  }
}
