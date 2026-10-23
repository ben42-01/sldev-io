import { FolderOpen, SquareTerminal, Command as CommandIcon } from 'lucide-react'
import { openTerminal } from './dockApi'
import { shortcutLabel, staticCommands } from '../lib/commands'
import { pickRootFolder, workspace } from '../state/workspace'

const SHOWN = ['terminal.new', 'terminal.splitRight', 'palette.show', 'folder.open', 'sidebar.toggle', 'terminal.find']

export function Welcome(): React.JSX.Element {
  const cmds = staticCommands()
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1>sldev</h1>
        <p className="welcome-sub">Agentic coding workspace</p>
        <div className="welcome-actions">
          <button className="btn primary" onClick={() => openTerminal()}>
            <SquareTerminal size={15} /> New terminal
          </button>
          <button className="btn" onClick={() => void pickRootFolder()}>
            <FolderOpen size={15} /> Open folder
          </button>
          <button className="btn" onClick={() => workspace.set({ paletteOpen: true })}>
            <CommandIcon size={15} /> Commands
          </button>
        </div>
        <div className="welcome-keys">
          {SHOWN.map((id) => {
            const c = cmds.find((x) => x.id === id)!
            return (
              <div key={id} className="welcome-key">
                <span>{c.title}</span>
                <kbd>{shortcutLabel(c)}</kbd>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
