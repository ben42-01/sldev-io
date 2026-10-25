import type { Mission } from '@shared/types'
import { Ellipsis, FileDiff, FolderGit2, GitBranch, Play, Square, SquareTerminal } from 'lucide-react'
import { focusOrResume, isLive, missions, removeMission, reviewMission, stopMission } from '../state/missions'
import { useStore } from '../state/store'
import { getAgent } from '../state/agents'
import { useProfiles } from '../state/profiles'
import { openInEditor } from '../lib/actions'
import { openTerminal } from '../dock/dockApi'
import { showContextMenu, type MenuItem } from './ContextMenu'

const LABEL: Record<Mission['status'], string> = {
  starting: 'Starting',
  working: 'Working',
  waiting: 'Ready for you',
  'needs-input': 'Needs you',
  ended: 'Ended',
  failed: 'Failed'
}

export function MissionStatusPill({ status }: { status: Mission['status'] }): React.JSX.Element {
  return <span className={`mission-pill ${status}`}>{LABEL[status]}</span>
}

export function MissionCard({ mission: m, large = false }: { mission: Mission; large?: boolean }): React.JSX.Element {
  const hasPanel = useStore(missions, (s) => !!s.panels[m.id])
  const live = isLive(m.status)
  const profileName = useProfiles().find((p) => p.id === m.options.profile)?.name
  const menu = (): MenuItem[] => [
    { label: hasPanel ? 'Show terminal' : 'Resume session', icon: <SquareTerminal size={13} />, run: () => focusOrResume(m.id) },
    { label: 'Review changes', icon: <FileDiff size={13} />, run: () => reviewMission(m.id) },
    { label: 'Stop', icon: <Square size={13} />, disabled: !hasPanel || !live, run: () => stopMission(m.id) },
    { type: 'separator' },
    { label: 'Open folder in editor', run: () => void openInEditor(m.cwd, undefined, true) },
    { label: 'New terminal in mission folder', run: () => openTerminal({ cwd: m.cwd }) },
    { label: 'Copy prompt', run: () => void navigator.clipboard.writeText(m.prompt) },
    { label: 'Copy session id', disabled: !m.sessionId, run: () => void navigator.clipboard.writeText(m.sessionId ?? '') },
    { type: 'separator' },
    ...(m.worktree
      ? [
          { label: 'Remove (keep branch)', run: () => void removeMission(m.id, { removeWorktree: true, deleteBranch: false }) },
          { label: 'Remove worktree and branch', run: () => void removeMission(m.id, { removeWorktree: true, deleteBranch: true }) }
        ]
      : [{ label: 'Remove from list', run: () => void removeMission(m.id, { removeWorktree: false, deleteBranch: false }) }])
  ]
  return (
    <div className={`mission-card ${m.status}${large ? ' large' : ''}`} onDoubleClick={() => focusOrResume(m.id)} onContextMenu={(e) => showContextMenu(e, menu())}>
      <div className="mission-head">
        <MissionStatusPill status={m.status} />
        <span className="mission-agent">{profileName ? `${profileName} · ` : ''}{getAgent(m.options.agent).name}</span>
        <span className="mission-time">{ago(m.updatedAt)}</span>
      </div>
      <div className="mission-title" title={m.prompt}>{m.title}</div>
      {m.status === 'needs-input' && m.notification && <div className="mission-alert">{m.notification}</div>}
      {live && m.activity && m.status === 'working' && <div className="mission-activity">{m.activity}</div>}
      {m.lastMessage && (m.status !== 'working' || large) && <div className={`mission-message${large ? ' large' : ''}`}>{m.lastMessage}</div>}
      <div className="mission-branch" title={m.worktree?.path ?? m.cwd}>
        {m.worktree ? <><GitBranch size={11} /> {m.worktree.branch}</> : <><FolderGit2 size={11} /> in place</>}
      </div>
      <div className="mission-foot">
        {m.stats && (m.stats.files > 0 ? (
          <span className="stats">
            <span className="add">+{m.stats.insertions}</span> <span className="del">−{m.stats.deletions}</span> · {m.stats.files} file{m.stats.files === 1 ? '' : 's'}
          </span>
        ) : <span className="stats">no changes</span>)}
        <span className="spacer" />
        <button className="icon-btn" title="Review changes" onClick={() => reviewMission(m.id)}>
          <FileDiff size={13} />
        </button>
        {hasPanel && live ? (
          <button className="icon-btn danger" title="Stop" onClick={() => stopMission(m.id)}>
            <Square size={13} />
          </button>
        ) : null}
        <button className="icon-btn" title={hasPanel ? 'Show terminal' : 'Resume'} onClick={() => focusOrResume(m.id)}>
          {hasPanel ? <SquareTerminal size={13} /> : <Play size={13} />}
        </button>
        <button className="icon-btn" title="More" onClick={(e) => showContextMenu(e, menu())}>
          <Ellipsis size={13} />
        </button>
      </div>
    </div>
  )
}

export function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
