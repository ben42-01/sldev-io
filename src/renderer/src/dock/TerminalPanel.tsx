import { useEffect, useRef } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { ClipboardCopy, ClipboardPaste, Copy, Eraser, TextSelect } from 'lucide-react'
import {
  attachTerminal,
  clearTerminal,
  copyTerminalBuffer,
  copyTerminalSelection,
  detachTerminal,
  ensureTerminal,
  focusTerminal,
  pasteIntoTerminal,
  selectAllInTerminal,
  setTerminalListeners as setListeners,
  terminalHasSelection
} from '../lib/terminals'
import { showContextMenu, type MenuItem } from '../components/ContextMenu'
import { consumeFresh, type TerminalPanelParams } from './dockApi'
import { linkPanel } from '../state/runs'
import { linkMissionPanel, missionEnv, missionResumeCommand } from '../state/missions'
import { TerminalSearch } from './TerminalSearch'
import { basename } from '../lib/paths'

export function TerminalPanel(props: IDockviewPanelProps<TerminalPanelParams>): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const id = props.api.id

  useEffect(() => {
    const { cwd, initialInput, runtimeId, taskId, missionId, env, sshConnectionId, displayCommand } = props.params
    const fresh = consumeFresh(id)
    // restored mission panels resume the agent session instead of re-sending the prompt
    const command = missionId && !fresh ? (missionResumeCommand(missionId) ?? props.params.command) : props.params.command
    // a restored runtime/task panel waits for Enter instead of re-running its command on app start
    // hook port/token change every app start, so missions always get a fresh env
    ensureTerminal(id, { cwd, initialInput, command, displayCommand: command === props.params.command ? displayCommand : undefined, env: missionId ? missionEnv(missionId) : env, sshConnectionId, autostart: (!command && !sshConnectionId) || fresh })
    linkPanel(id, { runtimeId, taskId })
    if (missionId) linkMissionPanel(missionId, id)
    const baseTitle = props.api.title ?? 'terminal'
    setTerminalListeners({ id, keepTitle: !!command || !!sshConnectionId, baseTitle, setTitle: (t) => !props.api.getParameters<TerminalPanelParams>().customTitle && props.api.setTitle(t) })
    attachTerminal(id, ref.current!)
    const active = props.api.onDidActiveChange((e) => e.isActive && focusTerminal(id))
    // Sessions are disposed when the panel is *closed* (see Dock), not on unmount,
    // so a remount during drag/re-dock just re-attaches the live terminal.
    return () => {
      active.dispose()
      detachTerminal(id)
    }
  }, [id])

  return (
    <div className="terminal-panel">
      <TerminalSearch id={id} panelApi={props.api} />
      <div className="terminal-mount" ref={ref} onContextMenu={(e) => showContextMenu(e, terminalMenu(id))} />
    </div>
  )
}

const isMac = window.api.platform === 'darwin'

function terminalMenu(id: string): MenuItem[] {
  const after = (fn: () => void) => () => {
    fn()
    focusTerminal(id)
  }
  return [
    { label: 'Copy', icon: <Copy size={14} />, shortcut: isMac ? '⌘C' : 'Ctrl+C', disabled: !terminalHasSelection(id), run: after(() => copyTerminalSelection(id)) },
    { label: 'Paste', icon: <ClipboardPaste size={14} />, shortcut: isMac ? '⌘V' : window.api.platform === 'win32' ? 'Ctrl+V' : 'Ctrl+Shift+V', run: after(() => pasteIntoTerminal(id)) },
    { label: 'Select all', icon: <TextSelect size={14} />, run: after(() => selectAllInTerminal(id)) },
    { label: 'Copy all output', icon: <ClipboardCopy size={14} />, run: after(() => copyTerminalBuffer(id)) },
    { type: 'separator' },
    { label: 'Clear', icon: <Eraser size={14} />, run: after(() => clearTerminal(id)) }
  ]
}

function setTerminalListeners(o: { id: string; keepTitle: boolean; baseTitle: string; setTitle: (t: string) => void }): void {
  setListeners(o.id, {
    // Shells and agent CLIs set the window title (e.g. Claude Code shows the current task);
    // runtime and task panels keep their own name.
    onTitle: (t) => !o.keepTitle && o.setTitle(tabTitle(t) || o.baseTitle)
  })
}

/** Shorten shell titles like `user@host: ~/dev/project` to `project`; keep anything else (agent task titles). */
function tabTitle(raw: string): string {
  const t = raw.trim()
  const prompt = /^[^@\s]+@[^:\s]+:\s*(.+)$/.exec(t)
  const s = prompt ? basename(prompt[1]) : t
  return s.length > 48 ? s.slice(0, 47) + '…' : s
}
