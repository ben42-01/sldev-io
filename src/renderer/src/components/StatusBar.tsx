import { Bell, GitBranch, Radio, Settings, SquareTerminal, TriangleAlert } from 'lucide-react'
import { openSettings, showBranchPicker, showView } from '../lib/commands'
import { missions } from '../state/missions'
import { workspace } from '../state/workspace'
import { useStore } from '../state/store'
import { tildify } from '../lib/paths'
import { blockers } from '../lib/setup'
import { openSetup, setup } from '../state/setup'
import { UpdateChip } from './About'
import { BetaChip } from './BetaGate'
import { TrialChip } from './License'

export function StatusBar({ home }: { home: string }): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const branch = useStore(workspace, (w) => w.branch)
  const count = useStore(workspace, (w) => w.terminalCount)
  const broadcast = useStore(workspace, (w) => w.broadcastCount)
  const needsYou = useStore(missions, (s) => s.list.filter((m) => m.status === 'needs-input').length)
  const working = useStore(missions, (s) => s.list.filter((m) => m.status === 'working').length)
  const missing = useStore(setup, (s) => blockers(s.report).length)
  return (
    <footer className="statusbar">
      {branch && (
        <button className="status-item clickable" title="Switch branch" onClick={showBranchPicker}>
          <GitBranch size={12} /> {branch}
        </button>
      )}
      {root && <span className="status-item muted">{tildify(root, home)}</span>}
      <span className="status-spacer" />
      {broadcast > 0 && (
        <span className="status-item warn" title="Typing goes to several terminals (toggle from the command palette)">
          <Radio size={12} /> broadcast · {broadcast}
        </span>
      )}
      {(needsYou > 0 || working > 0) && (
        <button className={`status-item clickable${needsYou ? ' attention' : ''}`} onClick={() => showView('agents')} title="Agent missions">
          <Bell size={12} /> {needsYou ? `${needsYou} need${needsYou === 1 ? 's' : ''} you` : `${working} working`}
        </button>
      )}
      {missing > 0 && (
        <button className="status-item clickable attention" title="Required tools are missing" onClick={openSetup}>
          <TriangleAlert size={12} /> setup needed
        </button>
      )}
      <BetaChip />
      <TrialChip />
      <UpdateChip />
      <span className="status-item" title="Open terminals">
        <SquareTerminal size={12} /> {count}
      </span>
      <button className="status-item clickable" title="Settings" onClick={openSettings}>
        <Settings size={12} />
      </button>
    </footer>
  )
}
