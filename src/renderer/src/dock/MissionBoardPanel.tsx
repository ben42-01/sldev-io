import { useMemo } from 'react'
import { MissionCard } from '../components/MissionCard'
import { isLive, missions } from '../state/missions'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { basename } from '../lib/paths'

/** All missions of the current project at a glance: needs-you first, then working, then the rest. */
export function MissionBoardPanel(): React.JSX.Element {
  const list = useStore(missions, (s) => s.list)
  const root = useStore(workspace, (w) => w.rootFolder)
  const order: Record<string, number> = { 'needs-input': 0, waiting: 1, working: 2, starting: 3, failed: 4, ended: 5 }
  const mine = useMemo(() => list.filter((m) => m.root === root).sort((a, b) => order[a.status] - order[b.status] || b.updatedAt - a.updatedAt), [list, root])
  const live = mine.filter((m) => isLive(m.status))
  return (
    <div className="panel-page">
      <div className="panel-page-head">
        <h2>Missions</h2>
        <span className="muted">{root ? basename(root) : ''} · {live.length} active</span>
      </div>
      <div className="mission-grid">
        {mine.map((m) => <MissionCard key={m.id} mission={m} large />)}
        {!mine.length && <div className="muted">No missions yet. Start one from the Agent Missions sidebar.</div>}
      </div>
    </div>
  )
}
