import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { Mission } from '@shared/types'
import { activeIn, addTokens, clipSegments, median, NO_TOKENS, responseTimes, segments, timeIn, timeTicks, tokenTotal, type Segment, type TokenUsage } from '@shared/usage'
import { getAgent } from '../state/agents'
import { factory } from '../state/factory'
import { focusOrResume, isLive, missions } from '../state/missions'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { MissionStatusPill } from '../components/MissionCard'

type Range = 'today' | '7d' | '30d'
const RANGES: Array<[Range, string]> = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']]
const DAY = 86400000

function rangeStart(r: Range, now: number): number {
  if (r === 'today') {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  return now - (r === '7d' ? 7 : 30) * DAY
}

export function duration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.round(h / 24)}d`
}

export function tokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`
  return `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`
}

/** Usage across missions and factory runs: a timeline, time waiting on you, tokens and outcomes. */
export function DashboardPanel(): React.JSX.Element {
  const list = useStore(missions, (s) => s.list)
  const runs = useStore(factory, (s) => s.runs)
  const root = useStore(workspace, (w) => w.rootFolder)
  const [range, setRange] = useState<Range>('7d')
  const [scope, setScope] = useState<'project' | 'all'>(root ? 'project' : 'all')
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])
  const start = rangeStart(range, now)
  const shown = useMemo(() => list.filter((m) => (scope === 'all' || m.root === root) && activeIn(m, start, now, now)), [list, scope, root, start, now])
  const shownRuns = runs.filter((r) => (scope === 'all' || r.root === root) && r.updatedAt >= start)

  const [usage, setUsage] = useState<Record<string, TokenUsage | null>>({})
  const reqKey = shown.map((m) => `${m.id}:${m.updatedAt}`).join(',')
  useEffect(() => {
    const reqs = shown
      .filter((m) => m.options.agent === 'codex' || (m.options.agent ?? 'claude') === 'claude')
      .map((m) => ({ id: m.id, agent: m.options.agent ?? 'claude', cwd: m.cwd, from: m.createdAt, to: m.updatedAt, transcriptPath: m.transcriptPath }))
    void window.api.usage.tokens(reqs).then(setUsage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey])

  const working = timeIn(shown, 'working', start, now, now)
  const waiting = timeIn(shown, 'needs-input', start, now, now)
  const responses = responseTimes(shown, start, now, now)
  const med = median(responses)
  const byAgent = new Map<string, { usage: TokenUsage; reported: number; missions: number }>()
  for (const m of shown) {
    const name = getAgent(m.options.agent).name
    const e = byAgent.get(name) ?? { usage: NO_TOKENS, reported: 0, missions: 0 }
    const u = usage[m.id]
    byAgent.set(name, { usage: u ? addTokens(e.usage, u) : e.usage, reported: e.reported + (u ? 1 : 0), missions: e.missions + 1 })
  }
  const total = [...byAgent.values()].reduce((t, e) => t + tokenTotal(e.usage), 0)

  return (
    <div className="panel-page dashboard">
      <div className="panel-page-head">
        <h2>Usage</h2>
        <div className="seg sm">
          {RANGES.map(([id, label]) => (
            <button key={id} className={range === id ? 'on' : ''} onClick={() => setRange(id)}>{label}</button>
          ))}
        </div>
        <div className="seg sm">
          <button className={scope === 'project' ? 'on' : ''} disabled={!root} onClick={() => setScope('project')}>This project</button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>All projects</button>
        </div>
      </div>

      <div className="dash-tiles">
        <Tile label="Missions" value={String(shown.length)} sub={`${shown.filter((m) => isLive(m.status)).length} active now`} />
        <Tile label="Agents working" value={duration(working)} sub={shown.length ? `across ${shown.length} mission${shown.length === 1 ? '' : 's'}` : '—'} />
        <Tile label="Waiting on you" value={duration(waiting)} sub={med === null ? 'no answers yet' : `median answer ${duration(med)}`} warn={waiting > working / 2 && waiting > 60000} />
        <Tile label="Tokens" value={tokens(total)} sub="Claude Code and Codex logs" />
      </div>

      <section className="dash-card">
        <div className="dash-card-head">
          <h3>Timeline</h3>
          <Legend />
        </div>
        <Timeline missions={shown} start={start} end={now} />
      </section>

      <div className="dash-row">
        <section className="dash-card">
          <div className="dash-card-head"><h3>Tokens by agent</h3></div>
          <TokenBars byAgent={byAgent} />
        </section>
        <section className="dash-card">
          <div className="dash-card-head"><h3>Outcomes</h3></div>
          <Outcomes missions={shown} runs={shownRuns} />
        </section>
      </div>
    </div>
  )
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }): React.JSX.Element {
  return (
    <div className={`dash-tile${warn ? ' warn' : ''}`}>
      <span className="dash-tile-label">{label}</span>
      <b>{value}</b>
      <span className="dash-tile-sub">{sub}</span>
    </div>
  )
}

/** Shape carries the status as well as colour: amber and green are hard to tell apart for some readers. */
function Legend(): React.JSX.Element {
  return (
    <div className="dash-legend">
      <span><i className="sw working" /> Working</span>
      <span><i className="sw needs" /> Needs you</span>
      <span><i className="sw idle" /> Ready for you</span>
    </div>
  )
}

const LABEL_W = 210
const ROW_H = 24
const AXIS_H = 22
const MAX_ROWS = 40
const statusText: Record<string, string> = { starting: 'Starting', working: 'Working', 'needs-input': 'Needs you', waiting: 'Ready for you' }

function Timeline({ missions: list, start: rangeFrom, end }: { missions: Mission[]; start: number; end: number }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [tip, setTip] = useState<{ x: number; y: number; m: Mission; s: Segment } | null>(null)
  useEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])
  const rows = useMemo(
    () =>
      list
        .map((m) => ({ m, segs: clipSegments(segments(m, end), rangeFrom, end) }))
        .filter((r) => r.segs.length)
        .sort((a, b) => b.segs[0].from - a.segs[0].from),
    [list, rangeFrom, end]
  )
  if (!rows.length) return <div className="muted-note">No missions in this period.</div>
  // zoom to when something happened: a busy morning shouldn't be a sliver at the end of a week
  const first = Math.min(...rows.map((r) => r.segs[0].from))
  const start = Math.max(rangeFrom, first - (end - first) * 0.04)

  const plotW = width - LABEL_W - 8
  const x = (t: number): number => LABEL_W + ((t - start) / (end - start)) * plotW
  const ticks = timeTicks(start, end, Math.max(3, Math.floor(plotW / 110))).filter((t) => x(t) < width - 70)
  const fmt = (t: number): string =>
    end - start < 1.5 * DAY ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric' })
  const visible = rows.slice(0, MAX_ROWS)
  const height = AXIS_H + visible.length * ROW_H + 4

  return (
    <div className="timeline" ref={box} onMouseLeave={() => setTip(null)}>
      <svg width={width} height={height} role="img" aria-label="Mission timeline">
        <defs>
          <pattern id="tl-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" className="hatch-bg" />
            <line x1="0" y1="0" x2="0" y2="5" className="hatch-line" />
          </pattern>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={AXIS_H - 4} y2={height} className="tl-grid" />
            <text x={x(t) + 4} y={13} className="tl-tick">{fmt(t)}</text>
          </g>
        ))}
        {visible.map(({ m, segs }, i) => {
          const y = AXIS_H + i * ROW_H
          return (
            <g key={m.id} className="tl-row" onClick={() => focusOrResume(m.id)}>
              <rect x={0} y={y} width={width} height={ROW_H} className="tl-hit" />
              <text x={0} y={y + 15} className="tl-label">
                <tspan className="tl-agent">{getAgent(m.options.agent).name.split(' ')[0]}</tspan> {m.title.length > 26 ? `${m.title.slice(0, 25)}…` : m.title}
              </text>
              {segs.map((s, j) => {
                const thin = s.status === 'waiting' || s.status === 'starting'
                const h = thin ? 2 : 12
                return (
                  <rect
                    key={j}
                    x={x(s.from)}
                    y={y + (ROW_H - h) / 2}
                    width={Math.max(2, x(s.to) - x(s.from))}
                    height={h}
                    rx={1}
                    className={`tl-seg ${s.status}`}
                    onMouseMove={(e) => {
                      const r = box.current!.getBoundingClientRect()
                      setTip({ x: e.clientX - r.left, y: e.clientY - r.top, m, s })
                    }}
                  />
                )
              })}
            </g>
          )
        })}
      </svg>
      {rows.length > MAX_ROWS && <div className="muted-note">and {rows.length - MAX_ROWS} more</div>}
      {tip && (
        <div className="tl-tip" style={{ left: Math.min(tip.x + 12, width - 240), top: tip.y + 14 }}>
          <b>{tip.m.title}</b>
          <span>{getAgent(tip.m.options.agent).name} · {statusText[tip.s.status] ?? tip.s.status}</span>
          <span className="mono">
            {new Date(tip.s.from).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–{new Date(tip.s.to).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {duration(tip.s.to - tip.s.from)}
          </span>
        </div>
      )}
    </div>
  )
}

function TokenBars({ byAgent }: { byAgent: Map<string, { usage: TokenUsage; reported: number; missions: number }> }): React.JSX.Element {
  const rows = [...byAgent.entries()].sort((a, b) => tokenTotal(b[1].usage) - tokenTotal(a[1].usage))
  const max = Math.max(1, ...rows.map(([, e]) => tokenTotal(e.usage)))
  if (!rows.length) return <div className="muted-note">No missions in this period.</div>
  return (
    <div className="token-bars">
      {rows.map(([name, e]) => {
        const t = tokenTotal(e.usage)
        return (
          <div key={name} className="token-row" title={e.reported ? `input ${tokens(e.usage.input)} · output ${tokens(e.usage.output)} · cache read ${tokens(e.usage.cacheRead)} · cache write ${tokens(e.usage.cacheWrite)}` : undefined}>
            <span className="token-name">{name}</span>
            <span className="token-track">{e.reported > 0 && <i style={{ width: `${(t / max) * 100}%` }} />}</span>
            <span className="token-value">{e.reported ? tokens(t) : 'not reported'}</span>
            {e.reported > 0 && (
              <span className="token-split">
                in {tokens(e.usage.input)} · out {tokens(e.usage.output)} · cache {tokens(e.usage.cacheRead + e.usage.cacheWrite)}
                {e.reported < e.missions ? ` · ${e.reported} of ${e.missions} missions` : ''}
              </span>
            )}
          </div>
        )
      })}
      <div className="hint">Read from the logs Claude Code and Codex keep on this machine. Other agents don't record usage locally.</div>
    </div>
  )
}

function Outcomes({ missions: list, runs }: { missions: Mission[]; runs: ReturnType<typeof factory.get>['runs'] }): React.JSX.Element {
  const count = (f: (m: Mission) => boolean): number => list.filter(f).length
  const prs = runs.filter((r) => r.recipe.nodes.some((n) => n.kind === 'pr' && r.nodes[n.id]?.status === 'done')).length
  const wins = new Map<string, number>()
  for (const r of runs)
    for (const nr of Object.values(r.nodes)) {
      const w = nr.candidates?.find((c) => c.missionId === nr.winner)
      if (w) wins.set(w.spec, (wins.get(w.spec) ?? 0) + 1)
    }
  const live = list.filter((m) => isLive(m.status))
  return (
    <div className="outcomes">
      <dl>
        <dt>Missions finished</dt>
        <dd>{count((m) => m.status === 'ended')}</dd>
        <dt>Missions failed</dt>
        <dd>{count((m) => m.status === 'failed')}</dd>
        <dt>Factory runs done</dt>
        <dd>{runs.filter((r) => r.status === 'done').length} of {runs.length}</dd>
        <dt>Pull requests opened</dt>
        <dd>{prs}</dd>
        {[...wins.entries()].map(([spec, n]) => (
          <Fragment key={spec}>
            <dt>Bake-off wins: {spec}</dt>
            <dd>{n}</dd>
          </Fragment>
        ))}
      </dl>
      {live.length > 0 && (
        <>
          <div className="section-label">Active now</div>
          {live.map((m) => (
            <button key={m.id} className="active-row" onClick={() => focusOrResume(m.id)}>
              <MissionStatusPill status={m.status} />
              <span>{m.title}</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}
