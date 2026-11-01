import { useEffect, useState } from 'react'
import { ChartGantt, LayoutGrid, Rocket } from 'lucide-react'
import { activeIn, addTokens, NO_TOKENS, timeIn, tokenTotal, type TokenUsage } from '@shared/usage'
import { showView } from '../lib/commands'
import { getAgent } from '../state/agents'
import { useMissionCounts } from '../state/attention'
import { factory, openPipeline } from '../state/factory'
import { focusOrResume, isLive, missions } from '../state/missions'
import { useStore } from '../state/store'
import { openAgentsDashboard } from '../dock/AgentsPanel'
import { dollars, duration, tokens } from '../dock/DashboardPanel'
import { MissionStatusPill } from './MissionCard'
import { openDashboard, openNewMission } from './MissionsView'
import { ViewShell } from './RuntimesView'
import { Empty } from './States'
import { TimeAgo } from './TimeAgo'

const startOfToday = (now: number): number => {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** At a glance, across all projects: what needs you, today's usage, and the latest missions and runs. */
export function OverviewView(): React.JSX.Element {
  const list = useStore(missions, (s) => s.list)
  const runs = useStore(factory, (s) => s.runs)
  const { needsYou, working } = useMissionCounts()
  const ready = list.filter((m) => m.status === 'waiting').length
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])
  // the clock is read on every render too: a mission started since the last tick is newer than `now` and didn't count
  const end = Math.max(now, Date.now())
  const start = startOfToday(end)
  const today = list.filter((m) => activeIn(m, start, end, end))

  // token counts from the agents' own logs (Claude Code, Codex); main reads only what was appended
  const [usage, setUsage] = useState<Record<string, TokenUsage | null>>({})
  const reqKey = today.map((m) => `${m.id}:${m.updatedAt}`).join(',')
  useEffect(() => {
    const reqs = today
      .filter((m) => ['claude', 'codex'].includes(m.options.agent ?? 'claude'))
      .map((m) => ({ id: m.id, agent: m.options.agent ?? 'claude', cwd: m.cwd, from: m.createdAt, to: isLive(m.status) ? Date.now() : m.updatedAt, transcriptPath: m.transcriptPath }))
    if (reqs.length) void window.api.usage.tokens(reqs).then(setUsage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey])

  const byAgent = new Map<string, TokenUsage>()
  for (const m of today) {
    const u = usage[m.id]
    if (!u) continue
    const name = getAgent(m.options.agent).name
    byAgent.set(name, addTokens(byAgent.get(name) ?? NO_TOKENS, u))
  }
  const all = [...byAgent.values()].reduce(addTokens, NO_TOKENS)
  const latest = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6)
  const activeRuns = runs.filter((r) => r.status === 'running' || r.updatedAt >= start).slice(0, 4)

  return (
    <ViewShell
      title="Overview"
      actions={
        <>
          <button className="icon-btn" title="Agents board" aria-label="Agents board" onClick={openAgentsDashboard}>
            <LayoutGrid size={14} />
          </button>
          <button className="icon-btn" title="Usage dashboard" aria-label="Usage dashboard" onClick={openDashboard}>
            <ChartGantt size={14} />
          </button>
        </>
      }
    >
      <div className="overview">
        <div className="ov-now">
          <button className={`ov-stat${needsYou ? ' tone-attention' : ''}`} onClick={() => showView('agents')}>
            <b>{needsYou}</b>
            <span>need you</span>
          </button>
          <button className={`ov-stat${working ? ' tone-working' : ''}`} onClick={() => showView('agents')}>
            <b>{working}</b>
            <span>working</span>
          </button>
          <button className="ov-stat" onClick={() => showView('agents')}>
            <b>{ready}</b>
            <span>ready</span>
          </button>
        </div>

        <div className="section-label">Today</div>
        <dl className="ov-today">
          <div>
            <dt>Missions</dt>
            <dd>{today.length}</dd>
          </div>
          <div>
            <dt>Agents working</dt>
            <dd>{duration(timeIn(today, 'working', start, end, end))}</dd>
          </div>
          <div>
            <dt>Waiting on you</dt>
            <dd>{duration(timeIn(today, 'needs-input', start, end, end))}</dd>
          </div>
          <div title="What these tokens would cost at API list prices. On a subscription you pay your plan instead.">
            <dt>Tokens · est. cost</dt>
            <dd>{tokenTotal(all) ? `${tokens(tokenTotal(all))} · ~${dollars(all.cost)}` : '—'}</dd>
          </div>
        </dl>
        {byAgent.size > 0 && (
          <ul className="ov-agents">
            {[...byAgent].map(([name, u]) => (
              <li key={name}>
                <span>{name}</span>
                <span className="muted">{tokens(tokenTotal(u))}</span>
                <span className="muted">~{dollars(u.cost)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="section-label">Latest missions</div>
        {latest.length ? (
          <ul className="ov-list">
            {latest.map((m) => (
              <li key={m.id}>
                <button className="ov-row" title={m.activity ?? m.title} onClick={() => void focusOrResume(m.id)}>
                  <span className="ov-row-title">{m.title}</span>
                  <MissionStatusPill status={m.status} />
                  <span className="ov-row-meta">
                    {getAgent(m.options.agent).name} · <TimeAgo t={m.updatedAt} className="" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty
            title="No missions yet"
            hint="Give an agent a task; it shows up here while it works."
            action={
              <button className="btn sm" onClick={() => openNewMission()}>
                <Rocket size={13} /> New mission
              </button>
            }
          />
        )}

        {activeRuns.length > 0 && (
          <>
            <div className="section-label">Factory runs</div>
            <ul className="ov-list">
              {activeRuns.map((r) => (
                <li key={r.id}>
                  <button className="ov-row" title={r.intent} onClick={() => openPipeline(r.id)}>
                    <span className="ov-row-title">{r.intent}</span>
                    <span className="ov-row-meta">
                      {r.status} · <TimeAgo t={r.updatedAt} className="" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </ViewShell>
  )
}
