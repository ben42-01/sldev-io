import type { Mission } from '@shared/types'
import { useMemo } from 'react'
import { Bot, Check, Cpu, Ellipsis, FileDiff, Factory, FolderGit2, GitBranch, Hammer, NotebookText, Play, Repeat, Square, SquareTerminal, Trash2, FlaskConical, GitMerge } from 'lucide-react'
import { buildDraft, continueOnAgent, failoverAgent, focusOrResume, isLive, missions, reviewMission, reviewWithAgent, stopMission } from '../state/missions'
import { openNewMission } from './MissionsView'
import { openNewRun } from './FactoryView'
import { openRepeatDraft } from './AutomationsSection'
import { acceptPass } from '../state/automations'
import { useStore } from '../state/store'
import { getAgent } from '../state/agents'
import { allAgents } from '../lib/agents'
import { setRootFolder, workspace } from '../state/workspace'
import { basename } from '../lib/paths'
import { useProfiles } from '../state/profiles'
import { saveAsEval } from '../state/evals'
import { openInEditor } from '../lib/actions'
import { openTerminal } from '../dock/dockApi'
import { showContextMenu, type MenuItem } from './ContextMenu'
import { StatusDot, StatusPill } from './StatusDot'
import { missionSignal } from '@shared/status'
import { groupByRole, spentLine, spentTitle, sumSpent, type SpentSum } from '@shared/lead'
import { removeMissionFlow } from '../lib/removals'
import { openMissionDetails } from './MissionDetails'
import { TimeAgo } from './TimeAgo'
import { NewProjectResult } from './NewProjectResult'

export function MissionStatusPill({ status }: { status: Mission['status'] }): React.JSX.Element {
  return <StatusPill signal={missionSignal(status)} />
}

/** `large` for wide boards; `compact` is one row (status, title, agent, time), the rest on hover and in the menu. */
/** `project`: say which project the mission is in (Mission Control's All projects columns). */
export function MissionCard({ mission: m, large = false, compact = false, project = false }: { mission: Mission; large?: boolean; compact?: boolean; project?: boolean }): React.JSX.Element {
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
    ...(m.repeat?.accept && live ? [{ label: 'Accept this pass', icon: <Check size={13} />, run: () => acceptPass(m.id) }] : []),
    {
      label: m.repeat ? 'Repeat this brief again…' : 'Repeat…',
      icon: <Repeat size={13} />,
      disabled: !(m.brief ?? m.prompt).trim(),
      run: () => openRepeatDraft({ root: m.root, name: m.title.replace(/ · pass \d+(\/\d+)?$/, ''), brief: repeatBrief(m), kind: m.kind?.id, agent: m.options.agent })
    },
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
    { label: 'Save as eval…', icon: <FlaskConical size={13} />, disabled: !m.brief?.trim(), run: () => void saveAsEval(m) },
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
            {m.options.model ? ` (${m.options.model})` : ''}
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
        {project && <ProjectChip root={m.root} />}
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
      {m.kind?.id === 'lead' && <LeadWorkers lead={m} />}
      {m.kind?.id === 'new-project' && <NewProjectResult mission={m} />}
      {/* where it runs and what it changed share a line, so the footer has room for the actions in a narrow column */}
      <div className="mission-where">
        <span className="mission-branch" title={m.worktree?.path ?? m.cwd}>
          {m.worktree ? <><GitBranch size={11} /> {m.worktree.branch}</> : <><FolderGit2 size={11} /> in place</>}
        </span>
        {m.options.model && <span className="mission-model" title={`${getAgent(m.options.agent).name} runs on ${m.options.model}`}><Cpu size={11} /> {m.options.model}</span>}
        {m.stats && (m.stats.files > 0 ? (
          <span className="stats">
            <span className="add">+{m.stats.insertions}</span> <span className="del">−{m.stats.deletions}</span>
            {/* the Review button says the file count once the agent has stopped */}
            {showsReview(m) ? '' : ` · ${m.stats.files} file${m.stats.files === 1 ? '' : 's'}`}
          </span>
        ) : <span className="stats">no changes</span>)}
      </div>
      <div className="mission-foot">
        <span className="spacer" />
        <NextStep mission={m} />
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

/**
 * The one thing to do next, spelled out: answer the agent, review its diff, or build from its findings.
 * Everything else stays in the icons and the menu.
 */
function NextStep({ mission: m }: { mission: Mission }): React.JSX.Element | null {
  if (m.status === 'needs-input') {
    return (
      <button className="btn sm next-step" title="Show the terminal to answer the agent" onClick={() => focusOrResume(m.id)}>
        <SquareTerminal size={12} /> Answer
      </button>
    )
  }
  // a pass of a repeat that waits for you: accepting it stops the agent and the loop moves on
  if (m.repeat?.accept && isLive(m.status) && m.status !== 'working' && m.status !== 'starting') {
    return (
      <>
        <button className="icon-btn" title="Review changes" aria-label="Review changes" onClick={() => reviewMission(m.id)}>
          <FileDiff size={13} />
        </button>
        <button className="btn sm next-step" title={`Pass ${m.repeat.pass} is good: stop the agent and go on to the next pass`} onClick={() => acceptPass(m.id)}>
          <Check size={12} /> Accept pass
        </button>
      </>
    )
  }
  if (m.kind?.readOnly) {
    const draft = buildDraft(m.id)
    return (
      <button
        className="btn sm next-step"
        title={draft ? 'Start a Build mission from this report' : 'Nothing to build from yet: the agent left no report. Add handoff notes in the details, or wait for it to finish.'}
        disabled={!draft}
        onClick={() => openNewMission(draft)}
      >
        <Hammer size={12} /> Build from this
      </button>
    )
  }
  // a working agent's diff is still moving: the review is there, but not pushed
  if (!showsReview(m)) {
    return (
      <button className="icon-btn" title="Review changes" aria-label="Review changes" onClick={() => reviewMission(m.id)}>
        <FileDiff size={13} />
      </button>
    )
  }
  const files = m.stats?.files ?? 0
  return (
    <button className="btn sm next-step" title="Open the diff in a review tab" onClick={() => reviewMission(m.id)}>
      <FileDiff size={12} /> Review {files} file{files === 1 ? '' : 's'}
    </button>
  )
}

const showsReview = (m: Mission): boolean =>
  !m.kind?.readOnly && (m.stats?.files ?? 0) > 0 && m.status !== 'working' && m.status !== 'starting' && m.status !== 'needs-input'

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

/** A pass's brief carries the loop's own lines ("This is pass 2…"); repeating it again starts from the user's brief. */
function repeatBrief(m: Mission): string {
  const brief = m.brief ?? m.prompt
  return m.repeat ? brief.split(/\n\nThis is pass \d+/)[0] : brief
}

export function ago(t: number): string {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** A Lead's workers inside its card, as a small org chart: the Lead, then its workers by role, with status, agent and branch. */
function LeadWorkers({ lead }: { lead: Mission }): React.JSX.Element | null {
  const list = useStore(missions, (s) => s.list)
  const groups = useMemo(() => {
    const mine = list.filter((x) => x.delegate?.lead === lead.id).sort((a, b) => a.createdAt - b.createdAt)
    // a follow-up stands for its task: show the newest pass of each
    const tasks = mine.filter((x) => !(x.parent?.kind === 'follow-up' && mine.some((y) => y.id === x.parent!.id)))
    return groupByRole(
      tasks.map((t) => {
        let cur = t
        const passes = [t]
        for (let next = mine.find((y) => y.parent?.id === cur.id); next; next = mine.find((y) => y.parent?.id === cur.id)) passes.push((cur = next))
        return { task: t, cur, passes, role: t.delegate?.role, startedAt: t.createdAt }
      })
    )
  }, [list, lead.id])
  const workers = groups.flatMap((g) => g.workers)
  // what each role took, and the Lead's total: its workers' passes and the Lead itself
  const total = sumSpent([lead, ...workers.flatMap((w) => w.passes)])
  if (!workers.length) return <div className="lead-workers empty muted small">No workers yet: the Lead is planning.</div>
  const merged = workers.filter((w) => w.task.delegate?.merged).length
  return (
    <div className="lead-workers" aria-label="Workers">
      <div className="lead-workers-head muted small">{workers.length} worker{workers.length === 1 ? '' : 's'}{merged ? ` · ${merged} merged` : ''}</div>
      <div className="lead-org-lead" data-lead={lead.id}>
        <StatusDot signal={missionSignal(lead.status)} small />
        <span className="lead-worker-body">
          <span className="lead-worker-title">Lead</span>
          <span className="lead-worker-meta">
            <span className="lead-worker-agent">{getAgent(lead.options.agent).name}</span>
            <LeadBranch branch={lead.worktree?.branch} />
          </span>
          <LeadSpent sum={total} label="Total" />
        </span>
      </div>
      <div className="lead-org">
        {groups.map((g) => (
          <div key={g.label} className={`lead-org-role${g.role ? '' : ' none'}`} data-role={g.label}>
            <div className="lead-org-role-name">
              {g.label}
              <span className="lead-org-count">{g.workers.length}</span>
            </div>
            <LeadSpent sum={sumSpent(g.workers.flatMap((w) => w.passes))} />
            {g.workers.map(({ task, cur }) => (
              <button key={task.id} type="button" className="lead-worker" data-worker={task.id} onClick={() => openMissionDetails(cur.id)} title={`${task.title}${task.delegate?.why ? `\n${getAgent(cur.options.agent).name}: ${task.delegate.why}` : ''}`}>
                <StatusDot signal={missionSignal(cur.status)} small />
                <span className="lead-worker-body">
                  <span className="lead-worker-title">{task.title}</span>
                  <span className="lead-worker-meta">
                    <span className="lead-worker-agent">{getAgent(cur.options.agent).name}{cur !== task ? ' · fixing' : ''}</span>
                    <LeadBranch branch={cur.worktree?.branch ?? task.worktree?.branch} />
                  </span>
                </span>
                {task.delegate?.merged && <span className="lead-merged" title="Merged into the Lead's branch"><GitMerge size={11} /></span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** What a role's workers, or the whole Lead, took so far; nothing until one of them has finished. */
function LeadSpent({ sum, label }: { sum: SpentSum; label?: string }): React.JSX.Element | null {
  const line = spentLine(sum)
  if (!line) return null
  return (
    <span className={`lead-spent${sum.timeOnly ? ' time-only' : ''}`} title={spentTitle(sum)}>
      {label && <span className="lead-spent-label">{label}</span>}
      {line}
      {/* the total's hover says why; a role says it under its numbers */}
      {!label && sum.notes.map((n) => <span key={n} className="lead-spent-note">{n}</span>)}
    </span>
  )
}

function LeadBranch({ branch }: { branch?: string }): React.JSX.Element | null {
  if (!branch) return null
  return (
    <span className="lead-branch" title={branch}>
      <GitBranch size={10} />
      <span>{branch}</span>
    </span>
  )
}

/** The project a mission works in; a click opens that project. */
function ProjectChip({ root }: { root: string }): React.JSX.Element {
  const open = useStore(workspace, (w) => w.rootFolder === root)
  return (
    <button type="button" className={`mission-project${open ? ' open' : ''}`} title={open ? `${root} (open)` : `${root}\nClick to switch to this project`} onClick={() => !open && setRootFolder(root)}>
      {basename(root)}
    </button>
  )
}
