import { GitBranch, SquareTerminal } from 'lucide-react'
import { workspace } from '../state/workspace'
import { useStore } from '../state/store'
import { tildify } from '../lib/paths'

export function StatusBar({ home }: { home: string }): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const branch = useStore(workspace, (w) => w.branch)
  const count = useStore(workspace, (w) => w.terminalCount)
  return (
    <footer className="statusbar">
      {branch && (
        <span className="status-item">
          <GitBranch size={12} /> {branch}
        </span>
      )}
      {root && <span className="status-item muted">{tildify(root, home)}</span>}
      <span className="status-spacer" />
      <span className="status-item">
        <SquareTerminal size={12} /> {count}
      </span>
    </footer>
  )
}
