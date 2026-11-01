import { useEffect, useState } from 'react'
import { Bot, Command as CommandIcon, FolderOpen, Gauge, Home, Plus, Rocket, Server, SquareTerminal } from 'lucide-react'
import { openTerminal } from './dockApi'
import { openAgentsDashboard } from './AgentsPanel'
import { shortcutLabel, showCommandPalette, showView, staticCommands } from '../lib/commands'
import { openNewMission } from '../components/MissionsView'
import { basename, tildify } from '../lib/paths'
import { pickRootFolder, setRootFolder, workspace } from '../state/workspace'
import { loadRemote, openSshTerminal, remote } from '../state/remote'
import { useStore } from '../state/store'
import { Logo } from '../components/Logo'

const SHOWN = ['terminal.new', 'palette.show', 'quickopen', 'missions.new', 'missions.next', 'settings.open']

/** The empty dock: three ways to start (a local shell, a remote host, a coding agent) and the main shortcuts. */
export function Welcome(): React.JSX.Element {
  const cmds = staticCommands()
  const root = useStore(workspace, (w) => w.rootFolder)
  const recent = useStore(workspace, (w) => w.recentFolders)
  const connections = useStore(remote, (r) => r.connections)
  const loaded = useStore(remote, (r) => r.loaded)
  const [home, setHome] = useState('')
  useEffect(() => {
    void window.api.fs.home().then(setHome)
    if (!loaded) void loadRemote()
  }, [loaded])
  const newMission = (): void => openNewMission()
  const others = recent.filter((f) => f !== root).slice(0, 4)
  const [brief, setBrief] = useState('')
  const agentCard = (
    <section className="launch-card aurora">
      <div className="launch-head"><Bot size={15} /> Coding agent</div>
      <p className="launch-desc">Give an agent a task; sldev tracks it and tells you when it needs you.</p>
      {root && (
        <form
          className="launch-brief"
          onSubmit={(e) => {
            e.preventDefault()
            openNewMission(brief.trim() ? { brief: brief.trim() } : undefined)
            setBrief('')
          }}
        >
          <input value={brief} placeholder={`What should an agent do in ${basename(root)}?`} aria-label="Mission brief" onChange={(e) => setBrief(e.target.value)} />
          <kbd>Enter</kbd>
        </form>
      )}
      <div className="launch-actions">
        <button className="btn sm primary" onClick={newMission} disabled={!root} title={root ? undefined : 'Open a folder first'}>
          <Rocket size={13} /> New mission
        </button>
        <button className="btn sm" onClick={openAgentsDashboard}><Gauge size={13} /> Agents</button>
      </div>
    </section>
  )

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-logo">
          <Logo size={44} stroke={1} />
          <h1>sldev-io</h1>
        </div>
        <p className="welcome-sub">Agentic coding workspace</p>

        <div className="launch-cards">
          {root && agentCard}
          <section className="launch-card aurora">
            <div className="launch-head"><SquareTerminal size={15} /> Local shell</div>
            <p className="launch-desc">A terminal in your project, or anywhere on this machine.</p>
            <div className="launch-actions">
              {/* one primary per screen: with a project open, that's the agent card's */}
              <button className={`btn sm${root ? '' : ' primary'}`} onClick={() => openTerminal()} title={root ?? 'Home folder'}>
                <Plus size={13} /> {root ? `Open in ${basename(root)}` : 'New terminal'}
              </button>
              <button className="btn sm" onClick={() => void pickRootFolder()}><FolderOpen size={13} /> Browse…</button>
              <button className="btn sm ghost" onClick={() => home && openTerminal({ cwd: home })} title={home}><Home size={13} /> Home</button>
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

          <section className="launch-card aurora">
            <div className="launch-head"><Server size={15} /> Remote SSH</div>
            <p className="launch-desc">{connections.length ? 'A shell on one of your saved hosts.' : 'Save a host to open remote terminals here.'}</p>
            <div className="launch-actions">
              {connections.slice(0, 4).map((c) => (
                <button key={c.id} className="btn sm" title={`${c.username ? `${c.username}@` : ''}${c.host}`} onClick={() => openSshTerminal(c)}>
                  {c.name}
                </button>
              ))}
              <button className="btn sm ghost" onClick={() => showView('remote')}>
                {connections.length ? `Manage${connections.length > 4 ? ` · all ${connections.length}` : ''}` : <><Plus size={13} /> Add host</>}
              </button>
            </div>
          </section>

          {!root && agentCard}
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
