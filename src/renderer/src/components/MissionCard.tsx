import type { Mission } from '@shared/types'
import { Bot, Ellipsis, FileDiff, Factory, FolderGit2, GitBranch, Hammer, NotebookText, Play, Square, SquareTerminal, Trash2 } from 'lucide-react'
import { buildDraft, continueOnAgent, failoverAgent, focusOrResume, isLive, missions, reviewMission, reviewWithAgent, stopMission } from '../state/missions'
import { openNewMission } from './MissionsView'
import { openNewRun } from './FactoryView'
import { useStore } from '../state/store'
import { getAgent } from '../state/agents'
import { allAgents } from '../lib/agents'
import { workspace } from '../state/workspace'
import { useProfiles } from '../state/profiles'
import { openInEditor } from '../lib/actions'
import { openTerminal } from '../dock/dockApi'
import { showContextMenu, type MenuItem } from './ContextMenu'
import { StatusDot, StatusPill } from './StatusDot'
import { missionSignal } from '@shared/status'
import { removeMissionFlow } from '../lib/removals'
import { openMissionDetails } from './MissionDetails'
import { TimeAgo } from './TimeAgo'

export function MissionStatusPill({ status }: { status: Mission['status'] }): React.JSX.Element {
  return <StatusPill signal={missionSignal(status)} />
}

/** `large` for wide boards; `compact` is one row (status, title, agent, time), the rest on hover and in the menu. */
export function MissionCard({ mission: m, large = false, compact = false }: { mission: Mission; large?: boolean; compact?: boolean }): React.JSX.Element {
  const hasPanel = useStore(missions, (s) => !!s.panels[m.id])
  const live = isLive(m.status)
  const profileName = useProfiles().find((p) => p.id === m.options.profile)?.name
  const menu = (): MenuItem[] => [
    { label: 'Details and handoff…', icon: <NotebookText size={13} />, run: () => openMissionDetails(m.id) },
    { label: hasPanel ? 'Show terminal' : 'Resume session', icon: <SquareTerminal size={13} />, run: () => focusOrResume(m.id) },
    { label: 'Review changes', icon: <FileDiff size={13} />, run: () => reviewMission(m.id) },
    // a plan or findings become the brief of a Build mission
    ...(m.kind && m.kind.id !== 'build'
      ? [
          { label: 'Build from this…', icon: <Hammer size={13} />, disabled: !buildDraft(m.id), run: () => openNewMission(buildDraft(m.id)) },
          { label: 'Run a factory recipe from this…', icon: <Factory size={13} />, disabled: !buildDraft(m.id), run: () => openNewRun({ intent: m.title, seedMission: m.id }) }
        ]
      : []),
    { label: 'Stop', icon: <Square size={13} />, disabled: !hasPanel || !live, run: () => stopMission(m.id) },
    ...(m.limited && !m.continuedBy
      ? [
          { type: 'header' as const, label: 'Continue on another agent' },
          ...allAgents(workspace.get().customAgents)
            .filter((a) => a.id !== (m.options.agent || 'claude'))
            .map((a): MenuItem => ({ label: a.name, icon: <Bot size={13} />, run: () => void continueOnAgent(m.id, a.id) }))
        ]
      : []),
    { type: 'header', label: 'Review with another agent' },
    ...allAgents(workspace.get().customAgents)
      .filter((a) => a.id !== (m.options.agent || 'claude'))
      .map((a): MenuItem => ({ label: a.name, icon: <Bot size={13} />, run: () => void reviewWithAgent(m.id, a.id) })),
    { type: 'separator' },
    { label: 'Open folder in editor', run: () => void openInEditor(m.cwd, undefined, true) },
    { label: 'New terminal in mission folder', run: () => openTerminal({ cwd: m.cwd }) },
    { label: 'Copy prompt', run: () => void navigator.clipboard.writeText(m.prompt) },
    { label: 'Copy session id', disabled: !m.sessionId, run: () => void navigator.clipboard.writeText(m.sessionId ?? '') },
    { type: 'separator' },
    { label: m.worktree ? 'Remove mission and worktree…' : 'Remove from list…', icon: <Trash2 size={13} />, run: () => void removeMissionFlow(m.id) }
  ]
  if (compact) {
    const signal = missionSignal(m.status)
    const alert = m.limited && !m.continuedBy ? `${getAgent(m.options.agent).name} hit its usage limit` : m.status === 'needs-input' ? m.notification : undefined
    const sub = alert ?? (live && m.status === 'working' ? m.activity : m.lastMessage)
    return (
      <div className={`mission-row ${m.status}`} onDoubleClick={() => focusOrResume(m.id)} onContextMenu={(e) => showContextMenu(e, menu())}>
        <StatusDot signal={signal} />
        <div className="mission-row-main">
          <button type="button" className="mission-title" title={`${m.title}: brief, report and handoff`} onClick={() => openMissionDetails(m.id)}>{m.title}</button>
          <div className={`mission-row-sub${alert ? ' alert' : ''}`} title={sub}>
            <span className={`tone-${signal.tone}`}>{signal.label}</span>
            {' · '}{profileName ? `${profileName} · ` : ''}{getAgent(m.options.agent).name}
            {m.kind && m.kind.id !== 'build' ? ` · ${m.kind.name}` : ''}
            {sub ? ` · ${sub}` : ''}
          </div>
        </div>
        {m.stats && m.stats.files > 0 && (
          <span className="stats mission-row-stats"><span className="add">+{m.stats.insertions}</span> <span className="del">−{m.stats.deletions}</span></span>
        )}
        <TimeAgo t={m.updatedAt} className="mission-time" />
        <button className="icon-btn reveal" title={hasPanel ? 'Show terminal' : 'Resume'} aria-label={hasPanel ? 'Show terminal' : 'Resume'} onClick={() => focusOrResume(m.id)}>
          {hasPanel ? <SquareTerminal size={13} /> : <Play size={13} />}
        </button>
        <button className="icon-btn reveal" title="More" aria-label="More" onClick={(e) => showContextMenu(e, menu())}>
          <Ellipsis size={13} />
        </button>
      </div>
    )
  }
  return (
    <div className={`mission-card ${m.status}${large ? ' large' : ''}`} onDoubleClick={() => focusOrResume(m.id)} onContextMenu={(e) => showContextMenu(e, menu())}>
      <div className="mission-head">
        <MissionStatusPill status={m.status} />
        {m.kind && m.kind.id !== 'build' && <span className="mission-kind">{m.kind.name}</span>}
        <span className="mission-agent">{profileName ? `${profileName} · ` : ''}{getAgent(m.options.agent).name}</span>
        <TimeAgo t={m.updatedAt} className="mission-time" />
      </div>
      <button type="button" className="mission-title" title="Brief, report and handoff" onClick={() => openMissionDetails(m.id)}>{m.title}</button>
      {m.limited && !m.continuedBy ? (
        <LimitAlert mission={m} />
      ) : (
        m.status === 'needs-input' && m.notification && <div className="mission-alert">{m.notification}</div>
      )}
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
        {m.kind?.readOnly ? (
          <button className="icon-btn" title="Build from this" aria-label="Build from this" disabled={!buildDraft(m.id)} onClick={() => openNewMission(buildDraft(m.id))}>
            <Hammer size={13} />
          </button>
        ) : (
          <button className="icon-btn" title="Review changes" aria-label="Review changes" onClick={() => reviewMission(m.id)}>
            <FileDiff size={13} />
          </button>
        )}
        {hasPanel && live ? (
          <button className="icon-btn danger" title="Stop" aria-label="Stop" onClick={() => stopMission(m.id)}>
            <Square size={13} />
          </button>
        ) : null}
        <button className="icon-btn" title={hasPanel ? 'Show terminal' : 'Resume'} aria-label={hasPanel ? 'Show terminal' : 'Resume'} onClick={() => focusOrResume(m.id)}>
          {hasPanel ? <SquareTerminal size={13} /> : <Play size={13} />}
        </button>
        <button className="icon-btn" title="More" aria-label="More" onClick={(e) => showContextMenu(e, menu())}>
          <Ellipsis size={13} />
        </button>
      </div>
    </div>
  )
}

/** The agent stopped at its usage limit: one click hands the mission to the next agent. */
function LimitAlert({ mission: m }: { mission: Mission }): React.JSX.Element {
  const to = failoverAgent(m.options.agent)
  const others = allAgents(workspace.get().customAgents).filter((a) => a.id !== (m.options.agent || 'claude'))
  return (
    <div className="mission-alert limit" title={m.limited?.text}>
      <span>{getAgent(m.options.agent).name} hit its usage limit.</span>
      {to ? (
        <button className="btn sm" onClick={() => void continueOnAgent(m.id, to)}>Continue on {getAgent(to).name}</button>
      ) : (
        <button
          className="btn sm"
          onClick={(e) => showContextMenu(e, others.map((a): MenuItem => ({ label: a.name, icon: <Bot size={13} />, run: () => void continueOnAgent(m.id, a.id) })))}
        >
          Continue on…
        </button>
      )}
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
