import { DEFAULT_SETTINGS } from '@shared/types'
import { activeTerminalId, closeActive, openTerminal, splitActive } from '../dock/dockApi'
import { pickRootFolder, preferredEditor, setRootFolder, updateSettings, workspace, type ViewId } from '../state/workspace'
import { openInEditor } from './actions'
import { applyTerminalFont } from './terminals'
import { tildify } from './paths'

const isMac = window.api.platform === 'darwin'

export interface Command {
  id: string
  title: string
  category?: string
  /** e.g. { mac: 'Cmd+T', other: 'Ctrl+Shift+T' } */
  keys?: { mac: string; other: string }
  run: () => void
}

interface Chord {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  code: string
}

const CODE_ALIASES: Record<string, string> = { '`': 'Backquote', '=': 'Equal', '-': 'Minus', ',': 'Comma', '.': 'Period', '/': 'Slash' }

function parseChord(s: string): Chord {
  const parts = s.split('+')
  const key = parts.pop()!
  const has = (m: string): boolean => parts.includes(m)
  const code = CODE_ALIASES[key] ?? (/^\d$/.test(key) ? `Digit${key}` : /^[A-Z]$/i.test(key) ? `Key${key.toUpperCase()}` : key)
  return { ctrl: has('Ctrl'), shift: has('Shift'), alt: has('Alt'), meta: has('Cmd'), code }
}

export function shortcutLabel(c: Command): string | undefined {
  if (!c.keys) return undefined
  const s = isMac ? c.keys.mac : c.keys.other
  return isMac ? s.replace('Cmd', '⌘').replace('Shift', '⇧').replace('Alt', '⌥').replace('Ctrl', '⌃').replace(/\+/g, '') : s
}

const VIEWS: Array<[ViewId, string]> = [
  ['explorer', 'Explorer'],
  ['runtimes', 'Runtimes'],
  ['agents', 'Agent Missions'],
  ['tasks', 'Tasks'],
  ['skills', 'Skills'],
  ['workflows', 'GitHub Workflows'],
  ['notes', 'Notes'],
  ['remote', 'Remote Connections']
]

export function showView(view: ViewId): void {
  const w = workspace.get()
  if (w.activeView === view && w.sidebarVisible) return
  workspace.set({ activeView: view })
  if (!w.sidebarVisible) updateSettings({ sidebarVisible: true })
}

function changeFontSize(delta: number | null): void {
  const w = workspace.get()
  const size = delta === null ? DEFAULT_SETTINGS.terminalFontSize : Math.min(32, Math.max(8, w.terminalFontSize + delta))
  updateSettings({ terminalFontSize: size })
  applyTerminalFont(w.terminalFontFamily, size)
}

export function staticCommands(): Command[] {
  return [
    { id: 'palette.show', title: 'Show all commands', keys: { mac: 'Cmd+Shift+P', other: 'Ctrl+Shift+P' }, run: () => workspace.set({ paletteOpen: true }) },
    { id: 'terminal.new', category: 'Terminal', title: 'New terminal', keys: { mac: 'Cmd+T', other: 'Ctrl+Shift+T' }, run: () => openTerminal() },
    { id: 'terminal.splitRight', category: 'Terminal', title: 'Split terminal right', keys: { mac: 'Cmd+D', other: 'Ctrl+Shift+D' }, run: () => splitActive('right') },
    { id: 'terminal.splitDown', category: 'Terminal', title: 'Split terminal down', keys: { mac: 'Cmd+Shift+D', other: 'Ctrl+Alt+Shift+D' }, run: () => splitActive('below') },
    { id: 'terminal.floating', category: 'Terminal', title: 'New floating terminal', run: () => openTerminal({ floating: true }) },
    { id: 'terminal.close', category: 'Terminal', title: 'Close panel', keys: { mac: 'Cmd+W', other: 'Ctrl+Shift+W' }, run: closeActive },
    {
      id: 'terminal.find',
      category: 'Terminal',
      title: 'Find in terminal',
      keys: { mac: 'Cmd+F', other: 'Ctrl+Shift+F' },
      run: () => {
        const id = activeTerminalId()
        if (id) window.dispatchEvent(new CustomEvent('sldev:find', { detail: id }))
      }
    },
    { id: 'terminal.fontUp', category: 'Terminal', title: 'Increase font size', keys: { mac: 'Cmd+=', other: 'Ctrl+Shift+=' }, run: () => changeFontSize(1) },
    { id: 'terminal.fontDown', category: 'Terminal', title: 'Decrease font size', keys: { mac: 'Cmd+-', other: 'Ctrl+Shift+-' }, run: () => changeFontSize(-1) },
    { id: 'terminal.fontReset', category: 'Terminal', title: 'Reset font size', keys: { mac: 'Cmd+0', other: 'Ctrl+Shift+0' }, run: () => changeFontSize(null) },
    { id: 'sidebar.toggle', category: 'View', title: 'Toggle sidebar', keys: { mac: 'Cmd+B', other: 'Ctrl+Shift+B' }, run: () => updateSettings({ sidebarVisible: !workspace.get().sidebarVisible }) },
    { id: 'folder.open', category: 'Workspace', title: 'Open folder…', keys: { mac: 'Cmd+O', other: 'Ctrl+Shift+O' }, run: () => void pickRootFolder() },
    {
      id: 'folder.openInEditor',
      category: 'Workspace',
      title: 'Open workspace in preferred editor',
      keys: { mac: 'Cmd+Shift+O', other: 'Ctrl+Alt+O' },
      run: () => {
        const root = workspace.get().rootFolder
        if (root) void openInEditor(root, preferredEditor(), true)
      }
    },
    {
      id: 'folder.reveal',
      category: 'Workspace',
      title: 'Reveal workspace in file manager',
      run: () => {
        const root = workspace.get().rootFolder
        if (root) void window.api.shell.openPath(root)
      }
    },
    ...VIEWS.map(
      ([view, label], i): Command => ({
        id: `view.${view}`,
        category: 'View',
        title: `Show ${label}`,
        keys: { mac: `Cmd+${i + 1}`, other: `Ctrl+Shift+${i + 1}` },
        run: () => showView(view)
      })
    )
  ]
}

/** Commands that depend on current state: recent folders, installed editors. */
export function dynamicCommands(home: string): Command[] {
  const w = workspace.get()
  return [
    ...w.recentFolders.map((f): Command => ({ id: `recent.${f}`, category: 'Open recent', title: tildify(f, home), run: () => setRootFolder(f) })),
    ...w.editors.map((e): Command => ({
      id: `editor.prefer.${e.id}`,
      category: 'Preferred editor',
      title: `${e.name}${w.preferredEditor === e.id ? '  (current)' : ''}`,
      run: () => updateSettings({ preferredEditor: e.id })
    }))
  ]
}

export function matchShortcut(e: KeyboardEvent, commands: Command[]): Command | undefined {
  for (const c of commands) {
    if (!c.keys) continue
    const k = parseChord(isMac ? c.keys.mac : c.keys.other)
    if (k.code === e.code && k.ctrl === e.ctrlKey && k.shift === e.shiftKey && k.alt === e.altKey && k.meta === e.metaKey) return c
  }
  return undefined
}

/** Subsequence fuzzy match. Returns a score (higher is better) or -1. */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let ti = 0
  let score = 0
  let streak = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return -1
    streak = found === ti ? streak + 1 : 0
    score += 1 + streak * 2 + (found === 0 || /[\s/:.-]/.test(t[found - 1]) ? 3 : 0)
    ti = found + 1
  }
  return score - t.length * 0.01
}
