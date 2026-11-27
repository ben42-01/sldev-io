import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Bug,
  Command as CommandIcon,
  Compass,
  Factory,
  FlaskConical,
  FolderOpen,
  FolderPlus,
  Gauge,
  Home,
  ListChecks,
  Plus,
  Rocket,
  ScanEye,
  Server,
  Sparkles,
  SquareTerminal
} from 'lucide-react'
import { openTerminal } from './dockApi'
import { openAgentsDashboard } from './AgentsPanel'
import { shortcutLabel, showCommandPalette, showView, staticCommands } from '../lib/commands'
import { openNewMission } from '../components/MissionsView'
import { openNewRun } from '../components/FactoryView'
import { openRecipes } from './RecipesPanel'
import { basename, tildify } from '../lib/paths'
import { pickRootFolder, setRootFolder, workspace } from '../state/workspace'
import { openNewProject } from '../components/NewProjectDialog'
import { loadRemote, openSshTerminal, remote } from '../state/remote'
import { focusOrResume, missions } from '../state/missions'
import { getAgent } from '../state/agents'
import { useMissionCounts } from '../state/attention'
import { useStore } from '../state/store'
import { Logo } from '../components/Logo'
import { MissionStatusPill } from '../components/MissionCard'
import { TimeAgo } from '../components/TimeAgo'

const SHOWN = ['terminal.new', 'palette.show', 'quickopen', 'missions.new', 'missions.next', 'settings.open']

/**
 * One-click starts for the jobs people give agents most. `fill` puts a sentence opener in the brief box for the
 * user to finish; without it the mission form opens straight away with the kind and brief set.
 */
const STARTERS: { label: string; icon: typeof Bug; kind: string; fill?: string; brief?: string }[] = [
  { label: 'Fix a bug', icon: Bug, kind: 'investigate', fill: 'Find and fix why ' },
  { label: 'Write tests', icon: FlaskConical, kind: 'build', fill: 'Add tests for ' },
  { label: 'Plan a feature', icon: ListChecks, kind: 'plan', fill: 'Plan how to add ' },
  { label: 'Review my changes', icon: ScanEye, kind: 'review', brief: 'Review the uncommitted changes in this repository: bugs, missing tests and anything risky.' },
  { label: 'Explain this codebase', icon: Compass, kind: 'map', brief: 'Map this project: what it does, how it is laid out, and where to start reading.' }
]

function greeting(hour: number): string {
  if (hour < 5) return 'Working late'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** The empty dock: a brief box with starters, the missions to pick up again, the other ways in, and the main shortcuts. */
export function Welcome(): React.JSX.Element {
  const cmds = staticCommands()
  const root = useStore(workspace, (w) => w.rootFolder)
  const recent = useStore(workspace, (w) => w.recentFolders)
  const connections = useStore(remote, (r) => r.connections)
  const loaded = useStore(remote, (r) => r.loaded)
  const list = useStore(missions, (s) => s.list)
  const { needsYou, working } = useMissionCounts()
  const [home, setHome] = useState('')
  useEffect(() => {
    void window.api.fs.home().then(setHome)
    if (!loaded) void loadRemote()
  }, [loaded])
  const others = recent.filter((f) => f !== root).slice(0, 4)
  const [brief, setBrief] = useState('')
  const [kind, setKind] = useState<string | undefined>()
  const input = useRef<HTMLInputElement>(null)

  const project = root ? basename(root) : ''
  const mine = list.filter((m) => !root || m.root === root)
  const resume = [...mine].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3)
  const status = [
    needsYou ? `${needsYou} need${needsYou === 1 ? 's' : ''} you` : '',
    working ? `${working} working` : '',
    !needsYou && !working && mine.length ? `${mine.length} mission${mine.length === 1 ? '' : 's'} so far` : ''
  ].filter(Boolean)

  const launch = (): void => {
    openNewMission(brief.trim() || kind ? { brief: brief.trim() || undefined, kind } : undefined)
    setBrief('')
    setKind(undefined)
  }
  const start = (s: (typeof STARTERS)[number]): void => {
    if (s.brief) return openNewMission({ kind: s.kind, brief: s.brief })
    setKind(s.kind)
    setBrief(s.fill ?? '')
    requestAnimationFrame(() => {
      const el = input.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-hero">
          <div className="welcome-mark" aria-hidden>
            <Logo size={30} stroke={1.2} />
          </div>
          <h1>{root ? <>{greeting(new Date().getHours())}<span className="welcome-project"> · {project}</span></> : 'Welcome to sldev-io'}</h1>
          <p className="welcome-sub">
            {root ? (status.length ? status.join(' · ') : 'Your agents are standing by. What should they work on?') : 'Open a project to give agents work in it.'}
          </p>
        </div>

        {root ? (
          <section className="hero-prompt aurora">
            <form
              className="hero-form"
              onSubmit={(e) => {
                e.preventDefault()
                launch()
              }}
            >
              <Rocket size={16} className="hero-icon" aria-hidden />
              <input
                ref={input}
                value={brief}
                placeholder={`What should an agent do in ${project}?`}
                aria-label="Mission brief"
                onChange={(e) => {
                  setBrief(e.target.value)
                  if (!e.target.value) setKind(undefined)
                }}
              />
              <button type="submit" className="btn sm primary hero-go" title="Open the mission form with this brief">
                Launch <ArrowRight size={13} />
              </button>
            </form>
            <div className="hero-starters" role="group" aria-label="Starters">
              {STARTERS.map((s) => (
                <button key={s.label} type="button" className={`starter${kind === s.kind && brief === s.fill ? ' on' : ''}`} onClick={() => start(s)}>
                  <s.icon size={12} /> {s.label}
                </button>
              ))}
              <button type="button" className="starter ghost" onClick={openAgentsDashboard} title="Agents board">
                <Gauge size={12} /> Agents
              </button>
            </div>
          </section>
        ) : (
          <section className="hero-prompt aurora hero-open">
            <p>sldev runs your coding agents in your project, tracks them and tells you when they need you.</p>
            <div className="launch-actions">
              <button className="btn primary" onClick={() => void pickRootFolder()}>
                <FolderOpen size={14} /> Open a project…
              </button>
              <button className="btn" onClick={() => openNewProject('clone')}>
                <FolderPlus size={14} /> Clone from GitHub…
              </button>
              <button className="btn" onClick={() => openNewProject('scratch')}>
                <Sparkles size={14} /> Start from scratch…
              </button>
            </div>
            {others.length > 0 && (
              <div className="launch-chips">
                {others.map((f) => (
                  <button key={f} className="launch-chip mono" title={`Open ${f}`} onClick={() => void setRootFolder(f)}>
                    {tildify(f, home)}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {root && resume.length > 0 && (
          <section className="welcome-resume">
            <div className="welcome-section-head">
              <span>Pick up where you left off</span>
              <button className="link-btn" onClick={() => showView('agents')}>
                All missions <ArrowRight size={11} />
              </button>
            </div>
            <ul>
              {resume.map((m) => (
                <li key={m.id}>
                  <button className="resume-row" title={m.activity ?? m.title} onClick={() => void focusOrResume(m.id)}>
                    <MissionStatusPill status={m.status} />
                    <span className="resume-title">{m.title}</span>
                    <span className="resume-meta">
                      {getAgent(m.options.agent).name} · <TimeAgo t={m.updatedAt} className="" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="launch-cards">
          {root && (
            <section className="launch-card aurora">
              <div className="launch-head"><Factory size={15} /> Software Factory</div>
              <p className="launch-desc">Plan, build and review in a branch of their own; your checks run in between and you approve the pull request.</p>
              <div className="launch-actions">
                <button className="btn sm" onClick={() => openNewRun()}><Factory size={13} /> New run</button>
                <button className="btn sm ghost" onClick={() => openRecipes()}><BookOpen size={13} /> Recipes</button>
              </div>
            </section>
          )}
          <section className="launch-card aurora">
            <div className="launch-head"><SquareTerminal size={15} /> Local shell</div>
            <p className="launch-desc">A terminal in your project, or anywhere on this machine.</p>
            <div className="launch-actions">
              <button className="btn sm" onClick={() => openTerminal()} title={root ?? 'Home folder'}>
                <Plus size={13} /> {root ? 'New terminal' : 'Terminal'}
              </button>
              {root && <button className="btn sm ghost" onClick={() => void pickRootFolder()}><FolderOpen size={13} /> Browse…</button>}
              <button className="btn sm ghost" onClick={() => home && openTerminal({ cwd: home })} title={home}><Home size={13} /> Home</button>
            </div>
            {root && others.length > 0 && (
              <div className="launch-chips">
                {others.map((f) => (
                  <button key={f} className="launch-chip mono" title={`Open ${f}`} onClick={() => void setRootFolder(f)}>
                    {tildify(f, home)}
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className="launch-card aurora">
            <div className="launch-head"><Server size={15} /> Remote SSH</div>
            <p className="launch-desc">{connections.length ? 'A shell on one of your saved hosts.' : 'Save a host to open remote terminals here.'}</p>
            <div className="launch-actions">
              {connections.slice(0, 3).map((c) => (
                <button key={c.id} className="btn sm" title={`${c.username ? `${c.username}@` : ''}${c.host}`} onClick={() => openSshTerminal(c)}>
                  {c.name}
                </button>
              ))}
              <button className="btn sm ghost" onClick={() => showView('remote')}>
                {connections.length ? `Manage${connections.length > 3 ? ` · all ${connections.length}` : ''}` : <><Plus size={13} /> Add host</>}
              </button>
            </div>
          </section>
        </div>

        <div className="welcome-keys">
          {SHOWN.map((id) => {
            const c = cmds.find((x) => x.id === id)
            if (!c) return null
            return (
              <div key={id} className="welcome-key">
                <span>{c.title}</span>
                <kbd>{shortcutLabel(c)}</kbd>
              </div>
            )
          })}
          <button className="welcome-key link-row" onClick={showCommandPalette}>
            <span><CommandIcon size={12} /> All commands</span>
          </button>
        </div>
      </div>
    </div>
  )
}
