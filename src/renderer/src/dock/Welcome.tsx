import { FolderOpen, SquareTerminal, Command as CommandIcon } from 'lucide-react'
import { openTerminal } from './dockApi'
import { shortcutLabel, showCommandPalette, staticCommands } from '../lib/commands'
import { pickRootFolder } from '../state/workspace'
import { Logo } from '../components/Logo'

const SHOWN = ['terminal.new', 'terminal.splitRight', 'palette.show', 'quickopen', 'missions.new', 'folder.open', 'sidebar.toggle', 'settings.open']

export function Welcome(): React.JSX.Element {
  const cmds = staticCommands()
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-logo">
          <Logo size={56} stroke={1} />
          <h1>sldev</h1>
        </div>
        <p className="welcome-sub">Agentic coding workspace</p>
        <div className="welcome-actions">
          <button className="btn primary" onClick={() => openTerminal()}>
            <SquareTerminal size={15} /> New terminal
          </button>
          <button className="btn" onClick={() => void pickRootFolder()}>
            <FolderOpen size={15} /> Open folder
          </button>
          <button className="btn" onClick={showCommandPalette}>
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
