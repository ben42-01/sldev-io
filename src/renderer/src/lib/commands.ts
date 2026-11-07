import { releaseReviewFocus, toggleFocusMode } from '../state/focus'
import { appearance } from './theme'
import { DEFAULT_SETTINGS } from '@shared/types'
import { visibleTerminalIds, activeTerminalId, closeActive, openPanel, openTerminal, splitActive } from '../dock/dockApi'
import { isRightView, pickRootFolder, preferredEditor, refreshBranch, setRootFolder, updateSettings, workspace, type ViewId } from '../state/workspace'
import { showPicker, type PickItem } from '../state/picker'
import { openSetup } from '../state/setup'
import { checkForUpdates, reportBug } from '../state/updates'
import { openWhatsNew } from '../state/whatsNew'
import { openLicense } from '../components/License'
import { openInEditor } from './actions'
import { applyTerminalFont, focusTerminal, shellKind, toggleBroadcast, writeToTerminal } from './terminals'
import { basename, dirname, shellQuote, tildify } from './paths'
import { scrollToTop } from './scroll'
import { errText, showNotice } from './removals'
import { nextNeedsYou } from '../state/attention'
import { openAgentsDashboard } from '../dock/AgentsPanel'
import { openMissionControl } from '../dock/MissionControlPanel'
import { openNewMission } from '../components/MissionsView'
import { openNewRun } from '../components/FactoryView'
import { openRecipes } from '../dock/RecipesPanel'
import { openDiagrams } from '../dock/DiagramPanel'
import { openRecap } from '../components/RecapDialog'

const isMac = window.api.platform === 'darwin'

export interface Command {
  id: string
  title: string
  category?: string
  /** e.g. { mac: 'Cmd+T', other: 'Ctrl+Shift+T' } */
  keys?: { mac: string; other: string }
  /** shortcut only fires (and is only swallowed) when this returns true */
  when?: () => boolean
  run: () => void
}

interface Chord {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  code: string
}

const CODE_ALIASES: Record<string, string> = { '`': 'Backquote', '=': 'Equal', '-': 'Minus', ',': 'Comma', '.': 'Period', '/': 'Slash', Space: 'Space' }

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
  ['remote', 'Remote'],
  ['factory', 'Factory'],
  ['overview', 'Overview'],
  ['context', 'Project Context']
]

export function showView(view: ViewId): void {
  releaseReviewFocus()
  const w = workspace.get()
  if (isRightView(view)) {
    if (w.rightPanelTab !== view || !w.rightPanelVisible) updateSettings({ rightPanelTab: view, rightPanelVisible: true })
    return
  }
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

export function showCommandPalette(): void {
  const cmds = [...staticCommands().filter((c) => c.id !== 'palette.show'), ...dynamicCommands()]
  showPicker({
    placeholder: 'Type a command…',
    items: cmds.map((c): PickItem => ({ id: c.id, label: c.title, category: c.category, kbd: shortcutLabel(c), run: c.run }))
  })
}

export function showQuickOpen(): void {
  const root = workspace.get().rootFolder
  if (!root) return void pickRootFolder()
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  showPicker({
    placeholder: `Open file in ${basename(root)}…`,
    hint: 'Enter: open in editor · Alt+Enter: paste path into terminal · Ctrl+Enter: terminal in its folder',
    items: window.api.fs.listFiles(root).then((files) =>
      files.map((rel): PickItem => {
        const abs = `${root}${sep}${rel.split('/').join(sep)}`
        const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
        return {
          id: rel,
          label: rel.split('/').pop()!,
          detail: dir,
          run: () => void openInEditor(abs),
          alt: () => {
            const t = activeTerminalId()
            if (t) {
              writeToTerminal(t, shellQuote(abs, shellKind(t)) + ' ')
              focusTerminal(t)
            }
          },
          ctrl: () => void openTerminal({ cwd: dirname(abs) })
        }
      })
    )
  })
}

export function showBranchPicker(): void {
  const root = workspace.get().rootFolder
  if (!root) return
  const current = workspace.get().branch
  showPicker({
    placeholder: 'Switch branch…',
    items: window.api.git.branches(root).then((bs) =>
      bs.map((b): PickItem => ({
        id: b,
        label: b,
        detail: b === current ? 'current' : undefined,
        run: () => void window.api.git.switch(root, b).then(refreshBranch, (e) => void showNotice(`Couldn't switch to ${b}`, errText(e)))
      }))
    )
  })
}

export function openSettings(): void {
  openPanel('settings', 'settings', 'Settings')
}

export function showAbout(): void {
  openSettings()
  requestAnimationFrame(() => scrollToTop(document.getElementById('settings-about')))
}

export function staticCommands(): Command[] {
  return [
    { id: 'palette.show', title: 'Show all commands', keys: { mac: 'Cmd+Shift+P', other: 'Ctrl+Shift+P' }, run: showCommandPalette },
    { id: 'quickopen', category: 'Go', title: 'Quick open file…', keys: { mac: 'Cmd+P', other: 'Ctrl+Alt+P' }, run: showQuickOpen },
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
      when: () => !!activeTerminalId(),
      run: () => {
        const id = activeTerminalId()
        if (id) window.dispatchEvent(new CustomEvent('sldev:find', { detail: id }))
      }
    },
    {
      id: 'terminal.broadcast',
      category: 'Terminal',
      title: 'Toggle broadcast input to all visible terminals',
      keys: { mac: 'Cmd+Shift+B', other: 'Ctrl+Alt+B' },
      run: () => void toggleBroadcast(visibleTerminalIds())
    },
    { id: 'terminal.fontUp', category: 'Terminal', title: 'Increase font size', keys: { mac: 'Cmd+=', other: 'Ctrl+Shift+=' }, run: () => changeFontSize(1) },
    { id: 'terminal.fontDown', category: 'Terminal', title: 'Decrease font size', keys: { mac: 'Cmd+-', other: 'Ctrl+Shift+-' }, run: () => changeFontSize(-1) },
    { id: 'terminal.fontReset', category: 'Terminal', title: 'Reset font size', keys: { mac: 'Cmd+0', other: 'Ctrl+Shift+0' }, run: () => changeFontSize(null) },
    { id: 'view.theme', category: 'View', title: 'Toggle light / dark theme', run: () => updateSettings({ theme: appearance.get().theme === 'dark' ? 'light' : 'dark' }) },
    { id: 'view.theme.system', category: 'View', title: 'Theme: match system', run: () => updateSettings({ theme: 'system' }) },
    { id: 'view.tabLayout', category: 'View', title: 'Toggle tab layout (top / side list)', run: () => updateSettings({ tabLayout: workspace.get().tabLayout === 'side' ? 'top' : 'side' }) },
    { id: 'sidebar.toggle', category: 'View', title: 'Toggle sidebar', keys: { mac: 'Cmd+B', other: 'Ctrl+Shift+B' }, run: () => (releaseReviewFocus(), updateSettings({ sidebarVisible: !workspace.get().sidebarVisible })) },
    { id: 'view.focus', category: 'View', title: 'Focus mode (hide both sidebars)', keys: { mac: 'Cmd+Alt+F', other: 'Ctrl+Alt+F' }, run: toggleFocusMode },
    { id: 'rightPanel.toggle', category: 'View', title: 'Toggle right sidebar', keys: { mac: 'Cmd+Alt+B', other: 'Ctrl+Alt+Shift+B' }, run: () => (releaseReviewFocus(), updateSettings({ rightPanelVisible: !workspace.get().rightPanelVisible })) },
    { id: 'missions.new', category: 'Agents', title: 'New agent mission', keys: { mac: 'Cmd+Shift+M', other: 'Ctrl+Shift+M' }, run: () => openNewMission() },
    { id: 'missions.board', category: 'Agents', title: 'Open Mission Control (missions, factory runs, usage)', run: () => openMissionControl('missions') },
    { id: 'board.open', category: 'Agents', title: 'Open the work board (Backlog → Agent ready → Review)', run: () => openMissionControl('board') },
    { id: 'missions.runs', category: 'Factory', title: 'Open factory runs in Mission Control', run: () => openMissionControl('runs') },
    { id: 'factory.run', category: 'Factory', title: 'New factory run…', run: () => openNewRun() },
    { id: 'factory.recipes', category: 'Factory', title: 'Open recipes (library and builder)', run: () => openRecipes() },
    { id: 'factory.newRecipe', category: 'Factory', title: 'Build a new recipe', run: () => openRecipes({ mode: 'new' }) },
    { id: 'factory.importRecipe', category: 'Factory', title: 'Import a recipe (paste or file)', run: () => openRecipes({ mode: 'import' }) },
    { id: 'missions.next', category: 'Agents', title: 'Next mission that needs you', keys: { mac: 'Cmd+Shift+J', other: 'Ctrl+Shift+J' }, run: () => void (nextNeedsYou() || showNotice('Nothing needs you', 'No mission or factory run is waiting for you right now.')) },
    { id: 'agents.dashboard', category: 'Agents', title: 'Open agents dashboard (every running agent)', run: openAgentsDashboard },
    { id: 'recap.standup', category: 'Agents', title: 'Recap: standup (what agents did since your last working day)', run: () => openRecap('standup') },
    { id: 'recap.week', category: 'Agents', title: 'Recap: this week (agent work as Markdown)', run: () => openRecap('week') },
    { id: 'usage.dashboard', category: 'Agents', title: 'Open usage dashboard (timeline, tokens, waiting on you)', run: () => openMissionControl('usage') },
    { id: 'diagram.code', category: 'View', title: 'Open code map (imports between folders)', run: () => openDiagrams('code') },
    { id: 'diagram.schema', category: 'View', title: 'Open database schema diagram (tables and foreign keys)', run: () => openDiagrams('schema') },
    { id: 'git.branch', category: 'Git', title: 'Switch branch…', run: showBranchPicker },
    { id: 'preview.open', category: 'View', title: 'Open browser preview (localhost:3000)', run: () => openPanel('preview', `preview-${Date.now()}`, 'localhost:3000', { url: 'http://localhost:3000' }, 'right') },
    { id: 'settings.open', category: 'Preferences', title: 'Open settings', keys: { mac: 'Cmd+,', other: 'Ctrl+,' }, run: openSettings },
    { id: 'app.about', category: 'Help', title: 'About sldev-io', run: showAbout },
    { id: 'app.whatsNew', category: 'Help', title: "What's new", run: () => openWhatsNew() },
    { id: 'app.feedback', category: 'Help', title: 'Report a bug or send feedback', run: reportBug },
    { id: 'app.license', category: 'Help', title: 'Enter license key', run: openLicense },
    { id: 'app.buy', category: 'Help', title: 'Buy a license', run: openLicense },
    { id: 'app.checkUpdates', category: 'Help', title: 'Check for updates', run: () => {
      showAbout()
      void checkForUpdates()
    } },
    { id: 'setup.open', category: 'Preferences', title: 'Check setup (git, gh, agent CLIs…)', run: openSetup },
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
        keys: i < 9 ? { mac: `Cmd+${i + 1}`, other: `Ctrl+Shift+${i + 1}` } : undefined,
        run: () => showView(view)
      })
    )
  ]
}

let home = ''
void window.api.fs.home().then((h) => (home = h))

/** Commands that depend on current state: recent folders, installed editors. */
export function dynamicCommands(): Command[] {
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
    if (k.code === e.code && k.ctrl === e.ctrlKey && k.shift === e.shiftKey && k.alt === e.altKey && k.meta === e.metaKey && (!c.when || c.when())) return c
  }
  return undefined
}

export { fuzzyMatches, fuzzyScore } from './fuzzy'
