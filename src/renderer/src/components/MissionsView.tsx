import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentOptions, SavedMission } from '@shared/types'
import { Bookmark, ChartGantt, FilePlus2, LayoutGrid, Plus, Rocket, Rows3, StretchHorizontal } from 'lucide-react'
import { openMissionControl } from '../dock/MissionControlPanel'
import { isLive, missionMemory, missions, type MissionDraft } from '../state/missions'
import { withMemory } from '@shared/memory'
import { createStore, useStore } from '../state/store'
import { updateSettings, workspace } from '../state/workspace'
import { AgentOptionsFields } from './AgentOptionsFields'
import { getAgent, useAgents } from '../state/agents'
import { issueText } from '@shared/factory'
import { renderKind, type MissionKind } from '@shared/missionKinds'
import { getKind, createKind, loadKinds, useKinds } from '../state/missionKinds'
import { openInEditor } from '../lib/actions'
import { launchSaved, newSavedId, putSaved, removeSaved, useSaved } from '../state/savedMissions'
import { SavedMissionRow } from './SavedMissionRow'
import { IssuePicker } from './IssuePicker'
import { FolderField } from './FolderField'
import { basename } from '../lib/paths'
import { MissionCard } from './MissionCard'
import { ViewShell } from './RuntimesView'
import { Modal } from './Modal'
import { showNotice } from '../lib/removals'

export function openMissionBoard(): void {
  openMissionControl('missions')
}

export function openDashboard(): void {
  openMissionControl('usage')
}

const newMission = createStore<{ open: boolean; draft?: MissionDraft; n: number }>({ open: false, n: 0 })

/** Opens the New mission dialog, optionally filled in; it works from anywhere, sidebars open or closed. */
export function openNewMission(draft?: MissionDraft): void {
  if (!workspace.get().rootFolder) return void showNotice('No folder open', 'Open a project folder to launch agent missions in it.')
  newMission.set({ open: true, draft, n: newMission.get().n + 1 })
}

export function NewMissionHost(): React.JSX.Element | null {
  const s = useStore(newMission, (x) => x)
  const root = useStore(workspace, (w) => w.rootFolder)
  if (!s.open || !root) return null
  return <NewMissionForm key={s.n} root={root} draft={s.draft} onDone={() => newMission.set({ open: false, n: s.n })} />
}

export function MissionsView(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const list = useStore(missions, (s) => s.list)
  const compact = useStore(workspace, (w) => w.missionCards === 'compact')
  const mine = useMemo(() => list.filter((m) => m.root === root && !m.explains), [list, root])
  const active = mine.filter((m) => isLive(m.status))
  const recent = mine.filter((m) => !isLive(m.status))
  /** live missions started in another folder (picked in the form) stay visible here */
  const elsewhere = useMemo(() => list.filter((m) => m.root !== root && isLive(m.status)), [list, root])
  const later = useSaved(root)

  return (
    <ViewShell
      title="Agent Missions"
      actions={
        <>
          <button
            className="icon-btn"
            title={compact ? 'Show missions as cards' : 'Show missions as compact rows'}
            aria-label={compact ? 'Show missions as cards' : 'Show missions as compact rows'}
            onClick={() => updateSettings({ missionCards: compact ? 'cards' : 'compact' })}
          >
            {compact ? <StretchHorizontal size={14} /> : <Rows3 size={14} />}
          </button>
          <button className="icon-btn" title="Usage dashboard" aria-label="Usage dashboard" onClick={openDashboard}>
            <ChartGantt size={14} />
          </button>
          <button className="icon-btn" title="Open Mission Control" aria-label="Open Mission Control" onClick={openMissionBoard}>
            <LayoutGrid size={14} />
          </button>
          <button className="icon-btn" title="New mission" aria-label="New mission" onClick={() => openNewMission()}>
            <Plus size={14} />
          </button>
        </>
      }
    >
      <div className="view-scroll">
        {!root ? (
          <div className="empty-state"><p>Open a folder to launch agent missions in it.</p></div>
        ) : (
          <div className="view-footer">
            <button className="btn primary full" onClick={() => openNewMission()}>
              <Rocket size={14} /> New mission
            </button>
          </div>
        )}
        {later.length > 0 && <div className="section-label pad">Saved for later · {later.length}</div>}
        <div className="mission-list">{later.map((m) => <SavedMissionRow key={m.id} saved={m} />)}</div>
        {active.length > 0 && <div className="section-label pad">Active · {active.length}</div>}
        <div className="mission-list">{active.map((m) => <MissionCard key={m.id} mission={m} compact={compact} />)}</div>
        {elsewhere.length > 0 && <div className="section-label pad">Other folders · {elsewhere.length}</div>}
        <div className="mission-list">{elsewhere.map((m) => <MissionCard key={m.id} mission={m} compact={compact} />)}</div>
        {recent.length > 0 && <div className="section-label pad">Recent</div>}
        <div className="mission-list">{recent.slice(0, 30).map((m) => <MissionCard key={m.id} mission={m} compact={compact} />)}</div>
        {root && !mine.length && !later.length && (
          <div className="muted-note">
            A mission runs a coding agent (Claude Code, Codex, Cursor, Copilot, OpenCode, Gemini or your own CLI) on a prompt, optionally in its own git worktree. sldev-io tracks when it's working, when it needs you, and lets you review and merge the diff when it's done.
          </div>
        )}
      </div>
    </ViewShell>
  )
}

function NewMissionForm({ root: projectRoot, draft, onDone }: { root: string; draft?: MissionDraft; onDone: () => void }): React.JSX.Element {
  /** where the agent works: the open project unless another folder is picked */
  const was = draft?.saved
  const [root, setRoot] = useState(was?.root ?? projectRoot)
  const [prompt, setPrompt] = useState(was?.brief ?? draft?.brief ?? '')
  const [title, setTitle] = useState(was?.title ?? draft?.title ?? '')
  const [criteria, setCriteria] = useState(was?.criteria ?? '')
  const kinds = useKinds()
  // the id, not the object: a kind file edited while the form is open applies straight away
  const [kindId, setKindId] = useState(() => getKind(was?.kind ?? draft?.kind).id)
  const kind = kinds.find((k) => k.id === kindId) ?? getKind(kindId)
  const [options, setOptions] = useState<AgentOptions>(() => was?.options ?? withAccess({ agent: workspace.get().defaultAgent }, kind))
  const [isRepo, setIsRepo] = useState(false)
  /** the git check for the folder has answered (until then the folder hint stays quiet) */
  const [checked, setChecked] = useState(false)
  const [worktree, setWorktree] = useState(was?.worktree ?? kind.worktree)
  const [branches, setBranches] = useState<string[]>([])
  const [base, setBase] = useState(was?.base ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [issue, setIssue] = useState<number | undefined>(was?.issue)
  /** other agents to run the same prompt on (a bake-off) */
  const [compare, setCompare] = useState<string[]>(was?.compare ?? [])
  const agents = useAgents()

  // custom kinds are files the user edits in their editor: pick up changes when the window comes back
  useEffect(() => {
    void loadKinds(projectRoot)
    const again = (): void => void loadKinds(projectRoot)
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [projectRoot])

  const pickKind = (k: MissionKind): void => {
    setKindId(k.id)
    setWorktree(k.worktree)
    setOptions((o) => withAccess(o, k, kind))
    if (k.readOnly) setCompare([])
  }

  const [folderOk, setFolderOk] = useState(true)
  const keepBase = useRef(!!was?.base)
  // a new folder means new git facts; the base branch is reset rather than kept from the old repo
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      void window.api.fs.isDir(root).then((ok) => {
        if (!live) return
        setFolderOk(ok)
        if (!ok) return setIsRepo(false)
        void window.api.git.isRepo(root).then((r) => live && (setIsRepo(r), setChecked(true)))
        void window.api.git.branches(root).then((b) => live && setBranches(b))
        // a saved mission keeps its branch, as long as the folder still has it
        void window.api.git.branch(root).then((b) => live && setBase((cur) => (keepBase.current && cur ? cur : (b ?? ''))))
        keepBase.current = false
      })
    }, 250)
    return () => ((live = false), clearTimeout(t))
  }, [root])

  // a Map mission needs no brief: mapping the whole project is the task
  const briefOptional = kind.id === 'map'
  const ready = !!prompt.trim() || briefOptional
  const shownTitle = title.trim() || prompt.trim().split('\n')[0].slice(0, 60) || (briefOptional ? 'Map this project' : '')
  /** exactly what the agent receives as its first message (the profile's role goes in separately) */
  const sent = renderKind(kind, { title: shownTitle, brief: prompt, criteria })
  // startMission adds the memory line itself; this is only so the preview shows it
  const [memory, setMemory] = useState('')
  useEffect(() => {
    // the context matches depend on the brief: look them up once typing pauses
    let live = true
    const t = setTimeout(() => void missionMemory(root, options.agent, kind.id, prompt).then((m) => live && setMemory(m)), 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [root, options.agent, kind.id, prompt])

  const setAgentOptions = (p: Partial<AgentOptions>): void => setOptions((o) => (p.agent && p.agent !== o.agent ? withAccess({ ...o, ...p }, kind) : { ...o, ...p }))
  // the folder, branch and model rarely change: folded into one line, opened when something there needs fixing
  const [moreOpen, setMoreOpen] = useState(false)
  useEffect(() => {
    if (!folderOk) setMoreOpen(true)
  }, [folderOk])
  const optionsSummary = [
    basename(root) || 'no folder',
    !folderOk ? 'folder not found' : !checked ? '' : isRepo ? (worktree ? `new worktree from ${base || 'HEAD'}` : 'in place, on the current branch') : 'not a git repo',
    // model, effort and approval mode sit next to the agent, in view
    options.print ? 'print mode' : '',
    options.extraArgs ? 'extra arguments' : ''
  ]
    .filter(Boolean)
    .join(' · ')
  const briefRef = useRef<HTMLTextAreaElement>(null)
  const asSaved = (): SavedMission => ({
    id: was?.id ?? newSavedId(),
    project: was?.project ?? projectRoot,
    root,
    title: title.trim() || undefined,
    brief: prompt,
    criteria: criteria.trim() || undefined,
    kind: kind.id,
    options,
    worktree,
    base: base || undefined,
    compare: compare.length ? compare : undefined,
    issue,
    createdAt: was?.createdAt ?? Date.now(),
    updatedAt: Date.now()
  })
  const saveForLater = (): void => {
    if (!ready || busy) return
    putSaved(asSaved())
    onDone()
  }
  const launch = async (): Promise<void> => {
    if (!ready || busy) return
    if (!folderOk) return setError('Choose an existing folder for the agent to work in.')
    setBusy(true)
    setError('')
    try {
      await launchSaved(asSaved(), isRepo)
      if (was) removeSaved(was.id)
      onDone()
    } catch (e) {
      setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={was ? 'Saved mission' : 'New mission'} size="lg" onClose={onDone} busy={busy} initialFocus={briefRef} onSubmit={() => void launch()}>
    <div
      className="form mission-form"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void launch()
        }
      }}
    >
      <KindPicker kinds={kinds} value={kind} onChange={pickKind} root={projectRoot} />
      {/* a new agent clears the mode, so a read-only kind picks that agent's read-only mode again */}
      <AgentOptionsFields part="who" value={options} onChange={setAgentOptions} />
      {kind.readOnly && !getAgent(options.agent).readOnlyMode && <div className="hint">{getAgent(options.agent).name} has no read-only mode: the prompt asks it not to change anything, and its normal approvals still apply.</div>}
      {isRepo && <IssuePicker key={root} root={root} onPick={(i) => (setPrompt(issueText(i)), setTitle(i.title), setIssue(i.number))} />}
      <label className="field">
        <span>{kind.readOnly ? `What should ${getAgent(options.agent).name} find out?` : `What should ${getAgent(options.agent).name} do?`}</span>
        <textarea ref={briefRef} rows={6} value={prompt} placeholder={kind.placeholder ?? 'What the agent should do'} onChange={(e) => setPrompt(e.target.value)} />
        <span className="field-hint">Required. Sent as one argument, line breaks and quotes intact.</span>
      </label>
      <label className="field">
        <span>Acceptance criteria</span>
        <textarea rows={2} value={criteria} placeholder={'e.g. GET /users?page=2 returns 20 items\nnpm test passes'} onChange={(e) => setCriteria(e.target.value)} />
        <span className="field-hint">Optional. Included in the agent's prompt and shown again when you review the work.{kind.template.includes('{criteria}') ? '' : ` The ${kind.name} kind doesn't use them.`}</span>
      </label>
      {isRepo && !kind.readOnly && (
        <div className="field compare-agents">
          <span>Also run it on</span>
          <div className="compare-list">
            {agents
              .filter((a) => a.id !== (options.agent || 'claude') && a.installed !== false)
              .map((a) => (
                <label key={a.id} className={`chip-check${compare.includes(a.id) ? ' on' : ''}`}>
                  <input type="checkbox" checked={compare.includes(a.id)} onChange={(e) => setCompare((c) => (e.target.checked ? [...c, a.id] : c.filter((x) => x !== a.id)))} />
                  <span>{a.name}</span>
                </label>
              ))}
          </div>
          <span className="field-hint">
            {compare.length > 0
              ? 'Runs as a factory bake-off: every agent works in its own worktree, without stopping to ask, and you keep the best diff.'
              : 'Optional. Tick other agents to compare their versions side by side and keep one.'}
          </span>
        </div>
      )}
      <details className="form-more" open={moreOpen} onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}>
        <summary>
          <span className="form-more-label">Options</span>
          <span className="form-more-summary" title={root}>{optionsSummary}</span>
        </summary>
        <div className="form-more-body">
          <label className="field">
            <span>Title</span>
            <input value={title} maxLength={120} placeholder={shownTitle || 'e.g. Users pagination'} onChange={(e) => setTitle(e.target.value)} />
            <span className="field-hint">Optional. Names the mission, its tab and its branch.</span>
          </label>
          <FolderField
            value={root}
            onChange={setRoot}
            hint={!folderOk || !checked ? undefined : isRepo ? (worktree ? 'A git repository: the mission gets its own worktree and branch, cut from the branch below. Uncommitted files are not copied.' : 'A git repository: the agent works in this folder and its checked-out branch directly.') : 'Not a git repository: the agent works in the folder directly, without a worktree or diff review.'}
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
          <AgentOptionsFields part="how" value={options} onChange={setAgentOptions} showPrint={false} />
        </div>
      </details>
      {ready && !compare.length && (
        <details className="prompt-preview">
          <summary>Prompt preview</summary>
          <pre className="cmd-preview selectable">{withMemory(sent, memory)}</pre>
        </details>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="form-actions">
        <span className="form-note">Ctrl/Cmd+Enter launches</span>
        <button type="button" className="btn ghost" disabled={busy} onClick={onDone}>Cancel</button>
        <button type="button" className="btn" disabled={!ready || busy} title="Keep it in the missions list and launch it when you're ready" onClick={saveForLater}>
          <Bookmark size={14} /> {was ? 'Save changes' : 'Save for later'}
        </button>
        <button type="submit" className="btn primary" disabled={!ready || busy || !folderOk} title="Ctrl/Cmd+Enter">
          <Rocket size={14} /> {busy ? 'Launching…' : compare.length ? `Launch on ${compare.length + 1} agents` : 'Launch'}
        </button>
      </div>
    </div>
    </Modal>
  )
}

/** A read-only kind preselects the agent's read-only mode; leaving one drops that mode again. */
function withAccess(o: AgentOptions, next: MissionKind, prev?: MissionKind): AgentOptions {
  const ro = getAgent(o.agent).readOnlyMode
  if (!ro) return o
  if (next.readOnly) return { ...o, permissionMode: ro }
  return prev?.readOnly && o.permissionMode === ro ? { ...o, permissionMode: undefined } : o
}

function KindPicker({ kinds, value, onChange, root }: { kinds: MissionKind[]; value: MissionKind; onChange: (k: MissionKind) => void; root: string }): React.JSX.Element {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'project' | 'user'>('project')
  const [error, setError] = useState('')
  const create = async (): Promise<void> => {
    if (!name.trim()) return
    try {
      const path = await createKind(scope, root, name.trim(), value)
      setNaming(false)
      setName('')
      void openInEditor(path)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <div className="field">
      <span>Kind</span>
      <div className="kind-picker" role="radiogroup" aria-label="Mission kind">
        {kinds.map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={k.id === value.id}
            className={k.id === value.id ? 'on' : ''}
            title={k.path ?? k.description}
            onClick={() => onChange(k)}
          >
            {k.name}
          </button>
        ))}
      </div>
      <span className="field-hint">
        {value.description}
        {value.path ? (
          <> <span className="link" onClick={() => void openInEditor(value.path!)}>Edit</span></>
        ) : null}{' '}
        <span className="link" onClick={() => setNaming((n) => !n)}>
          <FilePlus2 size={11} /> New kind from this one
        </span>
      </span>
      {naming && (
        <div className="kind-new">
          <input
            autoFocus
            value={name}
            placeholder="e.g. Security audit"
            aria-label="New kind name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.preventDefault(), void create())
              // preventDefault keeps Esc from cancelling the whole dialog
              if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), setNaming(false))
            }}
          />
          <select value={scope} aria-label="Where to keep it" onChange={(e) => setScope(e.target.value as 'project' | 'user')}>
            <option value="project">This project (.sldev/missions)</option>
            <option value="user">All my projects</option>
          </select>
          <button type="button" className="btn sm" disabled={!name.trim()} onClick={() => void create()}>Create and edit</button>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="field-hint">A Markdown file: front matter for the defaults, then the prompt template with {'{title}'}, {'{brief}'} and {'{criteria}'}. It opens in your editor.</div>
        </div>
      )}
    </div>
  )
}
