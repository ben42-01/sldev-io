import { useEffect, useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { ArrowRight, ChartGantt, Columns3, Factory, LayoutGrid, List, Rocket, Satellite } from 'lucide-react'
import type { Mission } from '@shared/types'
import type { FactoryRun } from '@shared/factory'
import { missionSignal } from '@shared/status'
import { MissionCard } from '../components/MissionCard'
import { SavedMissionRow } from '../components/SavedMissionRow'
import { useSaved } from '../state/savedMissions'
import { openNewMission } from '../components/MissionsView'
import { openNewRun, RunRow } from '../components/FactoryView'
import { StatusDot } from '../components/StatusDot'
import { Empty } from '../components/States'
import { nextNeedsYou } from '../state/attention'
import { factory } from '../state/factory'
import { isLive, missions } from '../state/missions'
import { useStore } from '../state/store'
import { updateSettings, workspace } from '../state/workspace'
import { basename } from '../lib/paths'
import { DashboardPanel } from './DashboardPanel'
import { openPanel } from './dockApi'

export type ControlTab = 'missions' | 'runs' | 'usage'

/** The one place for agent work: missions, factory runs and usage, in the main area so the sidebars can stay closed. */
export function openMissionControl(tab: ControlTab = 'missions'): void {
  // `at` makes a repeat call with the same tab still switch to it after the user moved to another
  openPanel('missions', 'mission-board', 'Mission Control', { tab, at: Date.now() })
}

const TABS: Array<{ id: ControlTab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'missions', label: 'Missions', icon: Rocket },
  { id: 'runs', label: 'Factory runs', icon: Factory },
  { id: 'usage', label: 'Usage', icon: ChartGantt }
]

const LAYOUTS: Array<{ id: 'columns' | 'grid' | 'list'; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'columns', label: 'Columns by status', icon: Columns3 },
  { id: 'grid', label: 'Grid', icon: LayoutGrid },
  { id: 'list', label: 'List', icon: List }
]

/** Board columns, left to right in the order work moves; the finished column only keeps the latest. */
const COLUMNS: Array<{ id: string; title: string; status: Mission['status']; has: (m: Mission) => boolean; empty: string }> = [
  { id: 'needs', title: 'Needs you', status: 'needs-input', has: (m) => m.status === 'needs-input', empty: 'Nothing is waiting for you.' },
  { id: 'working', title: 'Working', status: 'working', has: (m) => m.status === 'working' || m.status === 'starting', empty: 'No agent is working.' },
  { id: 'ready', title: 'Ready', status: 'waiting', has: (m) => m.status === 'waiting', empty: 'Agents that finished a turn wait here for review or a follow-up.' },
  { id: 'finished', title: 'Finished', status: 'ended', has: (m) => m.status === 'ended' || m.status === 'failed', empty: 'Ended missions land here.' }
]
const FINISHED_SHOWN = 20
const ORDER: Record<Mission['status'], number> = { 'needs-input': 0, waiting: 1, working: 2, starting: 3, failed: 4, ended: 5 }

export function MissionControlPanel({ params }: IDockviewPanelProps<{ tab?: ControlTab; at?: number }>): React.JSX.Element {
  const [tab, setTab] = useState<ControlTab>(params.tab ?? 'missions')
  useEffect(() => {
    if (params.tab) setTab(params.tab)
  }, [params.tab, params.at])
  const root = useStore(workspace, (w) => w.rootFolder)
  const list = useStore(missions, (s) => s.list)
  const runs = useStore(factory, (s) => s.runs)
  const mine = useMemo(() => list.filter((m) => m.root === root), [list, root])
  const live = mine.filter((m) => isLive(m.status))
  const needs = live.filter((m) => m.status === 'needs-input').length
  const myRuns = useMemo(() => runs.filter((r) => r.root === root), [runs, root])
  const activeRuns = myRuns.filter(runActive)
  const subtitle = [root ? basename(root) : 'No folder open', `${live.length} live mission${live.length === 1 ? '' : 's'}`, needs && `${needs} need${needs === 1 ? 's' : ''} you`, activeRuns.length && `${activeRuns.length} factory run${activeRuns.length === 1 ? '' : 's'} going`]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="mc">
      <header className="mc-head">
        <div className="board-icon aurora"><Satellite size={17} /></div>
        <div className="board-title">
          <h2>Mission Control</h2>
          <div className="muted small">{subtitle}</div>
        </div>
        <div className="mc-tabs" role="tablist" aria-label="Mission Control">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`mc-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
              <t.icon size={13} /> {t.label}
              {t.id === 'missions' && live.length > 0 && <span className="seg-count">{live.length}</span>}
              {t.id === 'runs' && activeRuns.length > 0 && <span className="seg-count">{activeRuns.length}</span>}
            </button>
          ))}
        </div>
      </header>
      <div className="mc-body" role="tabpanel">
        {tab === 'missions' && <MissionsBoard root={root} mine={mine} needs={needs} />}
        {tab === 'runs' && <RunsBoard root={root} runs={myRuns} />}
        {tab === 'usage' && <DashboardPanel />}
      </div>
    </div>
  )
}

function runActive(r: FactoryRun): boolean {
  return r.status === 'running' || r.status === 'paused'
}

function MissionsBoard({ root, mine, needs }: { root: string | null; mine: Mission[]; needs: number }): React.JSX.Element {
  const layout = useStore(workspace, (w) => w.missionLayout)
  const sorted = useMemo(() => [...mine].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.updatedAt - a.updatedAt), [mine])
  const later = useSaved(root)
  return (
    <div className="panel-page mc-page">
      <div className="board-filters">
        <div className="seg sm" role="group" aria-label="Mission layout">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" className={layout === l.id ? 'on' : ''} aria-pressed={layout === l.id} title={l.label} onClick={() => updateSettings({ missionLayout: l.id })}>
              <l.icon size={13} /> {l.label.split(' ')[0]}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className="btn sm" disabled={!needs} onClick={() => nextNeedsYou()} title="Go to the next mission that needs you (Ctrl+Shift+J)">
          Next <ArrowRight size={13} />
        </button>
        <button className="btn sm primary" disabled={!root} onClick={() => openNewMission()}>
          <Rocket size={13} /> New mission
        </button>
      </div>
      {later.length > 0 && (
        <section className="mc-saved" aria-label="Saved for later">
          <div className="section-label">Saved for later · {later.length}</div>
          <div className="mc-saved-list">{later.map((m) => <SavedMissionRow key={m.id} saved={m} />)}</div>
        </section>
      )}
      {!root ? (
        <Empty big icon={<Rocket size={22} />} title="No folder open" hint="Open a project folder to launch agent missions in it." />
      ) : !mine.length && later.length ? null : !mine.length ? (
        <Empty
          big
          icon={<Rocket size={22} />}
          title="No missions yet"
          hint="A mission runs a coding agent on a brief, optionally in its own git worktree. It shows up here with its state, what it's doing and the diff when it's done."
          action={<button className="btn sm" onClick={() => openNewMission()}><Rocket size={13} /> New mission</button>}
        />
      ) : layout === 'columns' ? (
        <div className="mc-columns">
          {COLUMNS.map((c) => {
            const all = sorted.filter(c.has)
            const shown = c.id === 'finished' ? all.slice(0, FINISHED_SHOWN) : all
            return (
              <section key={c.id} className="mc-column" data-column={c.id} aria-label={c.title}>
                <h3 className="mc-column-head">
                  <StatusDot signal={{ ...missionSignal(c.status), pulse: false }} small />
                  {c.title}
                  <span className="seg-count">{all.length}</span>
                </h3>
                <div className="mc-column-body">
                  {shown.map((m) => <MissionCard key={m.id} mission={m} />)}
                  {!all.length && <div className="mc-column-empty">{c.empty}</div>}
                  {all.length > shown.length && <div className="mc-column-empty">and {all.length - shown.length} older</div>}
                </div>
              </section>
            )
          })}
        </div>
      ) : layout === 'grid' ? (
        <div className="mission-grid">{sorted.map((m) => <MissionCard key={m.id} mission={m} large />)}</div>
      ) : (
        <div className="mc-list">{sorted.map((m) => <MissionCard key={m.id} mission={m} compact />)}</div>
      )}
    </div>
  )
}

function RunsBoard({ root, runs }: { root: string | null; runs: FactoryRun[] }): React.JSX.Element {
  const active = runs.filter(runActive)
  const rest = runs.filter((r) => !runActive(r))
  return (
    <div className="panel-page mc-page">
      <div className="board-filters">
        <span className="muted small">Click a run to open its pipeline.</span>
        <span className="grow" />
        <button className="btn sm primary" disabled={!root} onClick={() => openNewRun()}>
          <Factory size={13} /> New factory run
        </button>
      </div>
      {!runs.length ? (
        <Empty
          big
          icon={<Factory size={22} />}
          title="No factory runs yet"
          hint="A recipe is a graph of steps: agents write specs and code, commands check the result, you approve the steps that matter, and the last step opens a pull request."
          action={root ? <button className="btn sm" onClick={() => openNewRun()}><Factory size={13} /> New factory run</button> : undefined}
        />
      ) : (
        <>
          {active.length > 0 && <div className="section-label">Running · {active.length}</div>}
          <div className="mc-runs">{active.map((r) => <RunRow key={r.id} run={r} />)}</div>
          {rest.length > 0 && <div className="section-label">Finished · {rest.length}</div>}
          <div className="mc-runs">{rest.map((r) => <RunRow key={r.id} run={r} />)}</div>
        </>
      )}
    </div>
  )
}
