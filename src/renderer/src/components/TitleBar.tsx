import { Search } from 'lucide-react'
import { workspace } from '../state/workspace'
import { showAbout, showCommandPalette } from '../lib/commands'
import { useStore } from '../state/store'
import { basename } from '../lib/paths'
import { updates } from '../state/updates'
import { Logo } from './Logo'

const isMac = window.api.platform === 'darwin'

export function TitleBar(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const version = useStore(updates, (u) => u.info?.version)
  return (
    <div className={`titlebar${isMac ? ' mac' : ''}`}>
      <div className="titlebar-brand">
        <Logo size={16} />
        sldev-io
        {version && (
          <button className="titlebar-version" title="About sldev-io" onClick={showAbout}>
            v{version}
          </button>
        )}
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
