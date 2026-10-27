import { useEffect, useMemo, useState } from 'react'
import type { AgentOptions } from '@shared/types'
import { ChartGantt, LayoutGrid, Plus, Rocket } from 'lucide-react'
import { openPanel } from '../dock/dockApi'
import { isLive, missions, startMission } from '../state/missions'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { AgentOptionsFields } from './AgentOptionsFields'
import { getAgent, useAgents } from '../state/agents'
import { compareRecipe, issueText } from '@shared/factory'
import { missionPrompt } from '@shared/missionPrompt'
import { startRun } from '../state/factory'
import { getProfile } from '../state/profiles'
import { IssuePicker } from './IssuePicker'
import { FolderField } from './FolderField'
import { MissionCard } from './MissionCard'
import { ViewShell } from './RuntimesView'

export function openMissionBoard(): void {
  openPanel('missions', 'mission-board', 'Missions')
}

export function openDashboard(): void {
  openPanel('dashboard', 'usage-dashboard', 'Usage')
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
  /** live missions started in another folder (picked in the form) stay visible here */
  const elsewhere = useMemo(() => list.filter((m) => m.root !== root && isLive(m.status)), [list, root])

  return (
    <ViewShell
      title="Agent Missions"
      actions={
        <>
          <button className="icon-btn" title="Usage dashboard" aria-label="Usage dashboard" onClick={openDashboard}>
            <ChartGantt size={14} />
          </button>
          <button className="icon-btn" title="Mission board" aria-label="Mission board" onClick={openMissionBoard}>
            <LayoutGrid size={14} />
          </button>
          <button className="icon-btn" title="New mission" aria-label="New mission" onClick={() => setCreating(true)}>
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
        {elsewhere.length > 0 && <div className="section-label pad">Other folders · {elsewhere.length}</div>}
        <div className="mission-list">{elsewhere.map((m) => <MissionCard key={m.id} mission={m} />)}</div>
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

function NewMissionForm({ root: projectRoot, onDone }: { root: string; onDone: () => void }): React.JSX.Element {
  /** where the agent works: the open project unless another folder is picked */
  const [root, setRoot] = useState(projectRoot)
  const [prompt, setPrompt] = useState('')
  const [title, setTitle] = useState('')
  const [criteria, setCriteria] = useState('')
  const [options, setOptions] = useState<AgentOptions>(() => ({ agent: workspace.get().defaultAgent }))
  const [isRepo, setIsRepo] = useState(false)
  const [worktree, setWorktree] = useState(true)
  const [branches, setBranches] = useState<string[]>([])
  const [base, setBase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [issue, setIssue] = useState<number | undefined>()
  /** other agents to run the same prompt on (a bake-off) */
  const [compare, setCompare] = useState<string[]>([])
  const agents = useAgents()

  const [folderOk, setFolderOk] = useState(true)
  // a new folder means new git facts; the base branch is reset rather than kept from the old repo
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      void window.api.fs.isDir(root).then((ok) => {
        if (!live) return
        setFolderOk(ok)
        if (!ok) return setIsRepo(false)
        void window.api.git.isRepo(root).then((r) => live && setIsRepo(r))
        void window.api.git.branches(root).then((b) => live && setBranches(b))
        void window.api.git.branch(root).then((b) => live && setBase(b ?? ''))
      })
    }, 250)
    return () => ((live = false), clearTimeout(t))
  }, [root])

  const shownTitle = title.trim() || prompt.trim().split('\n')[0].slice(0, 60)
  /** exactly what the agent receives as its first message (the profile's role goes in separately) */
  const sent = missionPrompt({ title: shownTitle, brief: prompt, criteria })

  const launch = async (): Promise<void> => {
    if (!prompt.trim() || busy) return
    if (!folderOk) return setError('Choose an existing folder for the agent to work in.')
    setBusy(true)
    setError('')
    try {
      if (compare.length) {
        const profile = getProfile(options.profile)
        const ids = [options.agent || workspace.get().defaultAgent, ...compare.filter((c) => c !== options.agent)]
        await startRun({ recipe: compareRecipe(ids.map((id) => (profile ? `${profile.name}@${id}` : id))), intent: prompt, root, base, issue })
      } else await startMission({ prompt: sent, brief: prompt, criteria, title: shownTitle, root, options, worktree: isRepo && worktree, base })
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
      {isRepo && <IssuePicker key={root} root={root} onPick={(i) => (setPrompt(issueText(i)), setTitle(i.title), setIssue(i.number))} />}
      <label className="field">
        <span>What should {getAgent(options.agent).name} do?</span>
        <textarea autoFocus rows={6} value={prompt} placeholder="e.g. Add pagination to the /users endpoint and cover it with tests" onChange={(e) => setPrompt(e.target.value)} />
        <span className="field-hint">Required. Sent as one argument, line breaks and quotes intact.</span>
      </label>
      <label className="field">
        <span>Acceptance criteria</span>
        <textarea rows={2} value={criteria} placeholder={'e.g. GET /users?page=2 returns 20 items\nnpm test passes'} onChange={(e) => setCriteria(e.target.value)} />
        <span className="field-hint">Optional. Included in the agent's prompt and shown again when you review the work.</span>
      </label>
      <label className="field">
        <span>Title</span>
        <input value={title} maxLength={120} placeholder={shownTitle || 'e.g. Users pagination'} onChange={(e) => setTitle(e.target.value)} />
        <span className="field-hint">Optional. Names the mission, its tab and its branch.</span>
      </label>
      <FolderField
        value={root}
        onChange={setRoot}
        hint={!folderOk ? undefined : isRepo ? (worktree ? 'A git repository: the mission gets its own worktree and branch, cut from the branch below. Uncommitted files are not copied.' : 'A git repository: the agent works in this folder and its checked-out branch directly.') : 'Not a git repository: the agent works in the folder directly, without a worktree or diff review.'}
      />
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
      {isRepo && (
        <div className="field compare-agents">
          <span>Also run it on (compare the versions, keep one)</span>
          <div className="compare-list">
            {agents
              .filter((a) => a.id !== (options.agent || 'claude') && a.installed !== false)
              .map((a) => (
                <label key={a.id} className="check">
                  <input type="checkbox" checked={compare.includes(a.id)} onChange={(e) => setCompare((c) => (e.target.checked ? [...c, a.id] : c.filter((x) => x !== a.id)))} />
                  <span>{a.name}</span>
                </label>
              ))}
          </div>
          {compare.length > 0 && <div className="hint">Runs as a factory bake-off: every agent works in its own worktree, without stopping to ask, and you keep the best diff.</div>}
        </div>
      )}
      {prompt.trim() && !compare.length && (
        <details className="prompt-preview">
          <summary>Prompt preview</summary>
          <pre className="cmd-preview selectable">{sent}</pre>
        </details>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!prompt.trim() || busy || !folderOk} title="Ctrl/Cmd+Enter">
          <Rocket size={14} /> {busy ? 'Launching…' : compare.length ? `Launch on ${compare.length + 1} agents` : 'Launch'}
        </button>
      </div>
    </form>
  )
}
