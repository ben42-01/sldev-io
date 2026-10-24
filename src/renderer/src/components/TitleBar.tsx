import { Search } from 'lucide-react'
import { workspace } from '../state/workspace'
import { showCommandPalette } from '../lib/commands'
import { useStore } from '../state/store'
import { basename } from '../lib/paths'
import { Logo } from './Logo'

const isMac = window.api.platform === 'darwin'

export function TitleBar(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  return (
    <div className={`titlebar${isMac ? ' mac' : ''}`}>
      <div className="titlebar-brand">
        <Logo size={16} />
        sldev
      </div>
      <button className="titlebar-search" onClick={showCommandPalette}>
        <Search size={13} />
        <span>{root ? basename(root) : 'Search commands'}</span>
        <kbd>{isMac ? '⌘⇧P' : 'Ctrl+Shift+P'}</kbd>
      </button>
      <div className="titlebar-spacer" />
    </div>
  )
}
