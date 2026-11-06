import { spawn } from 'child_process'
import { constants, existsSync, promises as fsp } from 'fs'
import { tmpdir } from 'os'
import { basename, delimiter, join } from 'path'
import type { EditorInfo } from '@shared/types'
import { baseVersion } from './git'

interface EditorDef extends EditorInfo {
  bins: string[]
  /** macOS .app bundle name, used when the CLI shim isn't on PATH */
  macApp?: string
}

const EDITORS: EditorDef[] = [
  { id: 'cursor', name: 'Cursor', kind: 'gui', bins: ['cursor'], macApp: 'Cursor' },
  { id: 'vscode', name: 'VS Code', kind: 'gui', bins: ['code'], macApp: 'Visual Studio Code' },
  { id: 'vscode-insiders', name: 'VS Code Insiders', kind: 'gui', bins: ['code-insiders'], macApp: 'Visual Studio Code - Insiders' },
  { id: 'windsurf', name: 'Windsurf', kind: 'gui', bins: ['windsurf'], macApp: 'Windsurf' },
  { id: 'zed', name: 'Zed', kind: 'gui', bins: ['zed', 'zeditor'], macApp: 'Zed' },
  { id: 'sublime', name: 'Sublime Text', kind: 'gui', bins: ['subl'], macApp: 'Sublime Text' },
  { id: 'idea', name: 'IntelliJ IDEA', kind: 'gui', bins: ['idea', 'idea.sh'], macApp: 'IntelliJ IDEA' },
  { id: 'webstorm', name: 'WebStorm', kind: 'gui', bins: ['webstorm', 'webstorm.sh'], macApp: 'WebStorm' },
  { id: 'pycharm', name: 'PyCharm', kind: 'gui', bins: ['pycharm', 'pycharm.sh'], macApp: 'PyCharm' },
  { id: 'goland', name: 'GoLand', kind: 'gui', bins: ['goland', 'goland.sh'], macApp: 'GoLand' },
  { id: 'rustrover', name: 'RustRover', kind: 'gui', bins: ['rustrover', 'rustrover.sh'], macApp: 'RustRover' },
  { id: 'nvim', name: 'Neovim', kind: 'terminal', bins: ['nvim'] },
  { id: 'helix', name: 'Helix', kind: 'terminal', bins: ['hx', 'helix'] },
  { id: 'vim', name: 'Vim', kind: 'terminal', bins: ['vim'] }
]

const lookups = new Map<string, { at: number; found: Promise<string | null> }>()

/**
 * findOnPath without blocking the main process. On Windows a lookup is PATH folders × PATHEXT checks,
 * and a folder on a network or WSL drive can stall each one for seconds; done synchronously, that froze
 * the whole app. Results are kept for 30 s (polled views ask often), and per PATH, so a reload sees new tools.
 */
export function whichAsync(bin: string): Promise<string | null> {
  const key = `${process.env.PATH ?? ''}\0${bin}`
  const hit = lookups.get(key)
  if (hit && Date.now() - hit.at < 30000) return hit.found
  const found = lookup(bin)
  lookups.set(key, { at: Date.now(), found })
  return found
}

async function lookup(bin: string): Promise<string | null> {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  const candidates = (process.env.PATH ?? '').split(delimiter).filter(Boolean).flatMap((dir) => exts.map((ext) => join(dir, bin + ext)))
  const ok = await Promise.all(candidates.map((p) => fsp.access(p, constants.X_OK).then(() => true, () => false)))
  return candidates[ok.indexOf(true)] ?? null
}

function macAppPath(app?: string): string | null {
  if (process.platform !== 'darwin' || !app) return null
  for (const base of ['/Applications', join(process.env.HOME ?? '', 'Applications')]) {
    const p = join(base, `${app}.app`)
    if (existsSync(p)) return p
  }
  return null
}

let detected: Array<EditorDef & { bin: string | null; app: string | null }> | null = null

export async function detectEditors(): Promise<EditorInfo[]> {
  const found = await Promise.all(EDITORS.map(async (e) => ({ ...e, bin: (await Promise.all(e.bins.map(whichAsync))).find(Boolean) ?? null, app: macAppPath(e.macApp) })))
  detected = found.filter((e) => e.bin || e.app)
  return detected.map(({ id, name, kind }) => ({ id, name, kind, canDiff: !!diffArgs(id, 'a', 'b') }))
}

const VSCODE_FAMILY = ['cursor', 'vscode', 'vscode-insiders', 'windsurf']
const JETBRAINS = ['idea', 'webstorm', 'pycharm', 'goland', 'rustrover']

function diffArgs(id: string, left: string, right: string): string[] | null {
  if (VSCODE_FAMILY.includes(id)) return ['--diff', left, right]
  if (JETBRAINS.includes(id)) return ['diff', left, right]
  return null
}

/**
 * Opens the editor's own side-by-side diff: the file as it was at `base` (written to a temp file,
 * named after the base so the editor's tab says which side is which) against the working copy.
 */
export async function openDiffInEditor(id: string, cwd: string, base: string, path: string, oldPath?: string): Promise<boolean> {
  if (!detected) await detectEditors()
  const e = detected!.find((d) => d.id === id)
  if (!e?.bin || !diffArgs(id, '', '')) return false
  const dir = join(tmpdir(), 'sldev-review', `${Date.now().toString(36)}-${base.replace(/[^\w.-]+/g, '_').slice(0, 40)}`)
  await fsp.mkdir(dir, { recursive: true })
  const left = join(dir, basename(oldPath ?? path))
  await fsp.writeFile(left, await baseVersion(cwd, base, oldPath ?? path))
  const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(e.bin)
  // windowsHide only hides the cmd.exe running the .cmd shim, not the editor it starts
  const child = spawn(e.bin, diffArgs(id, left, join(cwd, path))!, { detached: true, stdio: 'ignore', shell: viaShell, windowsHide: viaShell })
  child.on('error', () => {})
  child.unref()
  return true
}

/** Arguments that open `file` at `line:col` for each editor family. */
function gotoArgs(id: string, file: string, line: number, col: number): string[] {
  if (VSCODE_FAMILY.includes(id)) return ['-g', `${file}:${line}:${col}`]
  if (['zed', 'sublime'].includes(id)) return [`${file}:${line}:${col}`]
  if (JETBRAINS.includes(id)) return ['--line', String(line), '--column', String(col), file]
  return [file]
}

/** Shell command for terminal editors at a line (renderer runs it in a terminal panel). */
export function terminalEditorGoto(id: string, file: string, line: number): string | null {
  const cmd = terminalEditorCommand(id)
  if (!cmd) return null
  const q = JSON.stringify(file)
  return cmd === 'hx' || cmd === 'helix' ? `${cmd} ${JSON.stringify(`${file}:${line}`)}` : `${cmd} +${line} ${q}`
}

/** Command line for terminal editors, which the renderer runs inside a terminal panel. */
export function terminalEditorCommand(id: string): string | null {
  const e = (detected ?? []).find((d) => d.id === id)
  return e && e.kind === 'terminal' ? e.bins[0] : null
}

export function openInEditor(id: string, target: string, line?: number, col = 1): boolean {
  if (!detected) detectEditors()
  const e = detected!.find((d) => d.id === id)
  if (!e || e.kind === 'terminal') return false
  const fileArgs = line ? gotoArgs(id, target, line, col) : [target]
  const [cmd, args] = e.bin ? [e.bin, fileArgs] : ['open', ['-a', e.app!, target]]
  const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)
  // windowsHide only hides the cmd.exe running the .cmd shim, not the editor it starts
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', shell: viaShell, windowsHide: viaShell })
  child.on('error', () => {})
  child.unref()
  return true
}
