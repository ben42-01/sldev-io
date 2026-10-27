import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Bot, NotebookText, Rocket, Search } from 'lucide-react'
import type { Mission } from '@shared/types'
import type { TokenUsage } from '@shared/usage'
import { missionSignal, needsYou } from '@shared/status'
import { openPanel } from './dockApi'
import { getAgent } from '../state/agents'
import { nextNeedsYou } from '../state/attention'
import { focusOrResume, isLive, missions } from '../state/missions'
import { useStore } from '../state/store'
import { showView } from '../lib/commands'
import { tildify } from '../lib/paths'
import { openMissionDetails } from '../components/MissionDetails'
import { StatusDot } from '../components/StatusDot'
import { Empty } from '../components/States'
import { duration, tokens } from './DashboardPanel'

export function openAgentsDashboard(): void {
  openPanel('agents', 'agents-dashboard', 'Agents')
}

type Filter = 'live' | 'needs' | 'working' | 'ready' | 'recent'
const DAY = 86400000

/** Attention first, then working, then the most recently updated. */
function rank(m: Mission): number {
  const s = missionSignal(m.status)
  return needsYou(s) && isLive(m.status) ? 0 : s.tone === 'working' ? 1 : 2
}

/** Every agent mission at a glance: state, what it's doing, where, how long and how many tokens. */
export function AgentsPanel(): React.JSX.Element {
  const list = useStore(missions, (s) => s.list)
  const [filter, setFilter] = useState<Filter>('live')
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(Date.now())
  const [usage, setUsage] = useState<Record<string, TokenUsage | null>>({})
  const [home, setHome] = useState('')
  const live = list.filter((m) => isLive(m.status))
  const anyLive = live.length > 0
  useEffect(() => void window.api.fs.home().then(setHome), [])
  // elapsed times tick only while something runs
  useEffect(() => {
    if (!anyLive) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [anyLive])

  const counts = {
    live: live.length,
    needs: live.filter((m) => m.status === 'needs-input').length,
    working: live.filter((m) => m.status === 'working' || m.status === 'starting').length,
    ready: live.filter((m) => m.status === 'waiting').length,
    recent: list.filter((m) => !isLive(m.status) && now - m.updatedAt < DAY).length
  }
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return list
      .filter((m) =>
        filter === 'recent' ? !isLive(m.status) && now - m.updatedAt < DAY : isLive(m.status) && (filter === 'live' || (filter === 'needs' ? m.status === 'needs-input' : filter === 'working' ? m.status === 'working' || m.status === 'starting' : m.status === 'waiting'))
      )
      .filter((m) => !q || `${m.title} ${m.activity ?? ''} ${getAgent(m.options.agent).name} ${m.options.model ?? ''} ${m.cwd}`.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)
    // `now` only matters for the "recent" cut-off; a minute's precision is plenty
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, filter, query, Math.floor(now / 60000)])

  // token counts for the agents that write local logs (Claude Code, Codex), refreshed every 10 s
  const tokenKey = shown.map((m) => m.id).join(',')
  useEffect(() => {
    const load = (): void => {
      const reqs = shown
        .filter((m) => ['claude', 'codex'].includes(m.options.agent ?? 'claude'))
        .map((m) => ({ id: m.id, agent: m.options.agent ?? 'claude', cwd: m.cwd, from: m.createdAt, to: isLive(m.status) ? Date.now() : m.updatedAt, transcriptPath: m.transcriptPath }))
      if (reqs.length) void window.api.usage.tokens(reqs).then(setUsage)
    }
    load()
    if (!anyLive) return
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenKey, anyLive])

  const FILTERS: Array<[Filter, string]> = [
    ['live', 'All live'],
    ['needs', 'Needs you'],
    ['working', 'Working'],
    ['ready', 'Ready'],
    ['recent', 'Finished today']
  ]
  const subtitle = [counts.working && `${counts.working} working`, counts.needs && `${counts.needs} need${counts.needs === 1 ? 's' : ''} you`, counts.ready && `${counts.ready} ready`].filter(Boolean).join(' · ') || 'Nothing running'

  return (
    <div className="panel-page agents-board">
      <header className="board-head">
        <div className="board-icon aurora"><Bot size={17} /></div>
        <div className="board-title">
          <h2>Agents</h2>
          <div className="muted small">{subtitle}</div>
        </div>
        <span className="grow" />
        <button className="btn sm" disabled={!counts.needs} onClick={() => nextNeedsYou()} title="Go to the next agent that needs you (Ctrl+Shift+J)">
          Next <ArrowRight size={13} />
        </button>
        <button className="btn sm primary" onClick={() => (showView('agents'), window.dispatchEvent(new Event('sldev:new-mission')))}>
          <Rocket size={13} /> New mission
        </button>
      </header>

      <div className="board-filters">
        <div className="seg sm" role="group" aria-label="Filter agents">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" className={filter === id ? 'on' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label} <span className="seg-count">{counts[id]}</span>
            </button>
          ))}
        </div>
        <label className="search-input">
          <Search size={12} />
          <input value={query} placeholder="Filter by title, activity, agent, model or folder…" aria-label="Filter by title, activity, agent, model or folder" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      {shown.length === 0 ? (
        query || filter !== 'live' ? (
          <Empty
            title={filter === 'needs' && !query ? 'Nothing needs your attention' : 'No matching agents'}
            action={<button className="btn sm" onClick={() => (setFilter('live'), setQuery(''))}>Clear filters</button>}
          />
        ) : (
          <Empty big icon={<Bot size={22} />} title="No agents running" hint="Start a mission and it shows up here with what it's doing, how long it has run and the tokens it used." action={<button className="btn sm" onClick={() => (showView('agents'), window.dispatchEvent(new Event('sldev:new-mission')))}><Rocket size={13} /> New mission</button>} />
        )
      ) : (
        <div className="agent-table" role="table" aria-label="Agents">
          {shown.map((m) => {
            const s = missionSignal(m.status)
            const u = usage[m.id]
            const agent = getAgent(m.options.agent)
            const elapsed = (isLive(m.status) ? now : m.updatedAt) - m.createdAt
            return (
              <div
                key={m.id}
                className={`agent-row${needsYou(s) && isLive(m.status) ? ' attention' : ''}`}
                role="row"
                tabIndex={0}
                onClick={() => void focusOrResume(m.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), void focusOrResume(m.id))}
                title="Open its terminal"
              >
                <StatusDot signal={s} />
                <div className="agent-main">
                  <div className="agent-title">{m.title}</div>
                  <div className="agent-sub">
                    <span className={`tone-${s.tone}`}>{s.label}</span>
                    {(m.status === 'needs-input' ? m.notification : m.activity) && <span className="agent-activity"> · {m.status === 'needs-input' ? m.notification : m.activity}</span>}
                  </div>
                  <div className="agent-where mono" title={m.cwd}>{m.worktree ? m.worktree.branch : tildify(m.cwd, home)}</div>
                </div>
                <div className="agent-col agent-who">
                  {agent.name}
                  {m.options.model && <span className="mono"> · {m.options.model}</span>}
                </div>
                <div className="agent-col mono num" title="Running time">{duration(elapsed)}</div>
                <div className="agent-col mono num" title={u ? `${u.input.toLocaleString()} in · ${u.output.toLocaleString()} out · ${u.cacheRead.toLocaleString()} cache read` : 'Token counts come from Claude Code and Codex logs'}>
                  {u ? `↑${tokens(u.input + u.cacheRead + u.cacheWrite)} ↓${tokens(u.output)}` : '—'}
                </div>
                <button
                  className="icon-btn reveal"
                  title="Brief, report and handoff"
                  aria-label="Brief, report and handoff"
                  onClick={(e) => (e.stopPropagation(), openMissionDetails(m.id))}
                >
                  <NotebookText size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
