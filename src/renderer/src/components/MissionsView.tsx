import { useEffect, useMemo, useState } from 'react'
import type { AgentOptions } from '@shared/types'
import { LayoutGrid, Plus, Rocket } from 'lucide-react'
import { openPanel } from '../dock/dockApi'
import { isLive, missions, startMission } from '../state/missions'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { AgentOptionsFields } from './AgentOptionsFields'
import { getAgent } from '../state/agents'
import { MissionCard } from './MissionCard'
import { ViewShell } from './RuntimesView'

export function openMissionBoard(): void {
  openPanel('missions', 'mission-board', 'Missions')
}

export function MissionsView(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const list = useStore(missions, (s) => s.list)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    const open = (): void => setCreating(true)
    window.addEventListener('sldev:new-mission', open)
    return () => window.removeEventListener('sldev:new-mission', open)
  }, [])
  const mine = useMemo(() => list.filter((m) => m.root === root), [list, root])
  const active = mine.filter((m) => isLive(m.status))
  const recent = mine.filter((m) => !isLive(m.status))

  return (
    <ViewShell
      title="Agent Missions"
      actions={
        <>
          <button className="icon-btn" title="Mission board" onClick={openMissionBoard}>
            <LayoutGrid size={14} />
          </button>
          <button className="icon-btn" title="New mission" onClick={() => setCreating(true)}>
            <Plus size={14} />
          </button>
        </>
      }
    >
      <div className="view-scroll">
        {!root ? (
          <div className="empty-state"><p>Open a folder to launch agent missions in it.</p></div>
        ) : creating ? (
          <NewMissionForm root={root} onDone={() => setCreating(false)} />
        ) : (
          <div className="view-footer">
            <button className="btn primary full" onClick={() => setCreating(true)}>
              <Rocket size={14} /> New mission
            </button>
          </div>
        )}
        {active.length > 0 && <div className="section-label pad">Active · {active.length}</div>}
        <div className="mission-list">{active.map((m) => <MissionCard key={m.id} mission={m} />)}</div>
        {recent.length > 0 && <div className="section-label pad">Recent</div>}
        <div className="mission-list">{recent.slice(0, 30).map((m) => <MissionCard key={m.id} mission={m} />)}</div>
        {root && !mine.length && !creating && (
          <div className="muted-note">
            A mission runs a coding agent (Claude Code, Codex, Cursor, Copilot, OpenCode, Gemini or your own CLI) on a prompt, optionally in its own git worktree. sldev-io tracks when it's working, when it needs you, and lets you review and merge the diff when it's done.
          </div>
        )}
      </div>
    </ViewShell>
  )
}

function NewMissionForm({ root, onDone }: { root: string; onDone: () => void }): React.JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [title, setTitle] = useState('')
  const [options, setOptions] = useState<AgentOptions>(() => ({ agent: workspace.get().defaultAgent }))
  const [isRepo, setIsRepo] = useState(false)
  const [worktree, setWorktree] = useState(true)
  const [branches, setBranches] = useState<string[]>([])
  const [base, setBase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.api.git.isRepo(root).then(setIsRepo)
    void window.api.git.branches(root).then(setBranches)
    void window.api.git.branch(root).then((b) => setBase(b ?? ''))
  }, [root])

  const launch = async (): Promise<void> => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await startMission({ prompt, title, root, options, worktree: isRepo && worktree, base })
      onDone()
    } catch (e) {
      setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        void launch()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void launch()
        }
        if (e.key === 'Escape') onDone()
      }}
    >
      <label className="field">
        <span>What should {getAgent(options.agent).name} do?</span>
        <textarea autoFocus rows={6} value={prompt} placeholder="Add pagination to the /users endpoint and cover it with tests" onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <label className="field">
        <span>Title (optional)</span>
        <input value={title} placeholder={prompt.split('\n')[0].slice(0, 60) || 'Users pagination'} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {isRepo && (
        <>
          <label className="check">
            <input type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} />
            <span>Isolate in a new git worktree</span>
          </label>
          {worktree && (
            <label className="field">
              <span>Branch from</span>
              <select value={base} onChange={(e) => setBase(e.target.value)}>
                {branches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          )}
        </>
      )}
      <AgentOptionsFields value={options} onChange={(p) => setOptions((o) => ({ ...o, ...p }))} showPrint={false} />
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!prompt.trim() || busy} title="Ctrl/Cmd+Enter">
          <Rocket size={14} /> {busy ? 'Launching…' : 'Launch'}
        </button>
      </div>
    </form>
  )
}
