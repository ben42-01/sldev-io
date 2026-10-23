import { spawn } from 'child_process'
import { accessSync, constants, existsSync } from 'fs'
import { delimiter, join } from 'path'
import type { EditorInfo } from '@shared/types'

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

function findOnPath(bin: string): string | null {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const p = join(dir, bin + ext)
      try {
        accessSync(p, constants.X_OK)
        return p
      } catch {
        // not here
      }
    }
  }
  return null
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

export function detectEditors(): EditorInfo[] {
  detected = EDITORS.map((e) => ({
    ...e,
    bin: e.bins.map(findOnPath).find(Boolean) ?? null,
    app: macAppPath(e.macApp)
  })).filter((e) => e.bin || e.app)
  return detected.map(({ id, name, kind }) => ({ id, name, kind }))
}

/** Arguments that open `file` at `line:col` for each editor family. */
function gotoArgs(id: string, file: string, line: number, col: number): string[] {
  if (['cursor', 'vscode', 'vscode-insiders', 'windsurf'].includes(id)) return ['-g', `${file}:${line}:${col}`]
  if (['zed', 'sublime'].includes(id)) return [`${file}:${line}:${col}`]
  if (['idea', 'webstorm', 'pycharm', 'goland', 'rustrover'].includes(id)) return ['--line', String(line), '--column', String(col), file]
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
  const child = spawn(cmd, args, {
    detached: true,
    stdio: 'ignore',
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)
  })
  child.on('error', () => {})
  child.unref()
  return true
}
