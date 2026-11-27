import { useEffect, useRef, useState } from 'react'
import { FolderGit2, FolderOpen, GitFork, Link2, Lock, Rocket, Sparkles } from 'lucide-react'
import {
  cloneProgress,
  filterRepos,
  folderNameProblem,
  newProjectBrief,
  NEW_PROJECT_LICENSES,
  parseCloneInput,
  projectSlug,
  repoFolderName,
  type CloneSource,
  type GhRepoList,
  type NewProjectLicense
} from '@shared/newProject'
import { renderKind } from '@shared/missionKinds'
import { cheapModelOf } from '../lib/agents'
import { getAgent, useAgents } from '../state/agents'
import { getKind } from '../state/missionKinds'
import { startMission } from '../state/missions'
import { createStore, useStore } from '../state/store'
import { setRootFolder, updateSettings, workspace } from '../state/workspace'
import { dirname } from '../lib/paths'
import { errText } from '../lib/removals'
import { Modal } from './Modal'
import { Empty, ErrorBanner, Loading } from './States'
import { toast } from './Toast'

type Mode = 'clone' | 'scratch'

const dialog = createStore<{ open: boolean; n: number; mode: Mode }>({ open: false, n: 0, mode: 'clone' })

/** New project…: clone a repository, or start one from scratch with an agent */
export function openNewProject(mode: Mode = 'clone'): void {
  dialog.set({ open: true, n: dialog.get().n + 1, mode })
}

export function NewProjectHost(): React.JSX.Element | null {
  const s = useStore(dialog, (d) => d)
  if (!s.open) return null
  return <NewProjectDialog key={s.n} initialMode={s.mode} onClose={() => dialog.set({ open: false, n: s.n, mode: s.mode })} />
}

type ListState = { loading: true } | ({ loading: false } & GhRepoList)

const ago = (iso: string): string => {
  const t = Date.parse(iso)
  if (!t) return ''
  const d = Math.floor((Date.now() - t) / 86400000)
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 60 ? `${d} days ago` : d < 730 ? `${Math.floor(d / 30)} months ago` : `${Math.floor(d / 365)} years ago`
}

function NewProjectDialog({ onClose, initialMode }: { onClose: () => void; initialMode: Mode }): React.JSX.Element {
  const [mode, setMode] = useState<Mode>(initialMode)
  const root = useStore(workspace, (w) => w.rootFolder)
  const savedParent = useStore(workspace, (w) => w.cloneParent)
  const [list, setList] = useState<ListState>({ loading: true })
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<CloneSource | null>(null)
  const [parent, setParent] = useState(savedParent ?? (root ? dirname(root) : ''))
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [target, setTarget] = useState<{ dest: string; problem: string | null } | null>(null)
  const [cloning, setCloning] = useState<{ id: string; output: string } | null>(null)
  const [error, setError] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const loadList = (): void => {
    setList({ loading: true })
    window.api.gh.repoList().then(
      (r) => setList({ loading: false, ...r }),
      (e) => setList({ loading: false, repos: [], error: errText(e) })
    )
  }
  useEffect(loadList, [])
  useEffect(() => {
    if (!parent) void window.api.fs.home().then((h) => setParent((p) => p || h))
  }, [])

  const repos = list.loading ? [] : filterRepos(list.repos, query)
  // owner/name of one of the user's own repositories is that row; anything else that looks like a URL is cloned as pasted
  const exact = repos.find((r) => r.nameWithOwner.toLowerCase() === query.trim().replace(/\.git$/, '').toLowerCase())
  const pasted = exact ? null : parseCloneInput(query)
  const shown = picked && repos.some((r) => r.url === picked.url) ? picked : null
  const source: CloneSource | null = exact ? { url: exact.url, name: repoFolderName(exact.nameWithOwner) } : (pasted ?? shown)
  useEffect(() => {
    if (!nameEdited) setName(source?.name ?? '')
  }, [source?.url])

  // ── Start from scratch ──
  const agents = useAgents()
  const cheapModels = useStore(workspace, (w) => w.cheapModels)
  const [description, setDescription] = useState('')
  const [agentId, setAgentId] = useState(() => workspace.get().defaultAgent || 'claude')
  const agent = agents.find((a) => a.id === agentId) ?? getAgent(agentId)
  const cheap = cheapModelOf(agent, cheapModels)
  const [model, setModel] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [license, setLicense] = useState<NewProjectLicense>('Apache-2.0')
  const [starting, setStarting] = useState(false)
  const describeRef = useRef<HTMLTextAreaElement>(null)
  /** the model field: the agent's low-cost one until the user types another */
  const shownModel = model ?? cheap ?? ''
  const folder = mode === 'scratch' ? projectName.trim() || (description.trim() ? projectSlug(description) : '') : name

  // the target is checked as it's typed, and again just before cloning or creating it (in main)
  useEffect(() => {
    if (!parent || !folder) return setTarget(null)
    let live = true
    const t = setTimeout(() => void window.api.git.cloneTarget(parent, folder).then((r) => live && setTarget(r)), 150)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [parent, folder])
  useEffect(() => (mode === 'scratch' ? describeRef : searchRef).current?.focus(), [mode])

  useEffect(() => {
    if (!cloning) return
    return window.api.git.onCloneOutput((id, text) => setCloning((c) => (c && c.id === id ? { ...c, output: (c.output + text).slice(-8000) } : c)))
  }, [cloning?.id])

  const nameProblem = folder ? folderNameProblem(folder) : null
  const problem = nameProblem ?? target?.problem ?? null
  const canClone = mode === 'clone' && !!source && !!parent && !!name && !problem && !!target && !cloning
  const canStart = mode === 'scratch' && !!description.trim() && !!parent && !!folder && !problem && !!target && !starting

  const start = async (): Promise<void> => {
    if (!canStart) return
    setError('')
    setStarting(true)
    try {
      // checked again now: the folder may have appeared since the last check
      const t = await window.api.git.cloneTarget(parent, folder)
      setTarget(t)
      if (t.problem) return
      const dest = await window.api.newProject.create(t.dest)
      updateSettings({ cloneParent: parent })
      // the mission runs the sldev-new-project skill from the folder itself, so every agent can read it
      await window.api.sldevSkills.install(dest)
      setRootFolder(dest)
      const kind = getKind('new-project')
      const title = projectName.trim() || folder
      const brief = newProjectBrief({ description, name: projectName, license })
      await startMission({
        prompt: renderKind(kind, { title, brief }),
        brief,
        title,
        root: dest,
        options: { agent: agent.id, model: shownModel.trim() || undefined },
        worktree: false,
        kind: { id: kind.id, name: kind.name, readOnly: kind.readOnly }
      })
      toast(`Created ${dest}: ${agent.name} is setting the project up`)
      onClose()
    } catch (e) {
      setError(errText(e))
    } finally {
      setStarting(false)
    }
  }

  const clone = async (): Promise<void> => {
    if (!source || !canClone) return
    setError('')
    // checked again now: the folder may have filled since the last check
    const t = await window.api.git.cloneTarget(parent, name)
    setTarget(t)
    if (t.problem) return
    const id = `clone-${Date.now()}`
    setCloning({ id, output: '' })
    updateSettings({ cloneParent: parent })
    try {
      await window.api.git.clone(id, source.url, t.dest)
      setRootFolder(t.dest)
      toast(`Cloned ${repoFolderName(source.url)} into ${t.dest}`)
      onClose()
    } catch (e) {
      const msg = errText(e)
      setError(/Cancelled\.?$/.test(msg) ? '' : msg)
      if (/Cancelled\.?$/.test(msg)) toast('Clone cancelled; the partial folder was removed.')
      setCloning(null)
    }
  }

  const browse = async (): Promise<void> => {
    const f = await window.api.fs.pickFolder(parent || undefined)
    if (f) setParent(f)
  }

  const progress = cloning ? cloneProgress(cloning.output) : null

  return (
    <Modal
      title="New project"
      size="lg"
      busy={!!cloning || starting}
      onClose={onClose}
      onSubmit={() => void (mode === 'scratch' ? start() : clone())}
      initialFocus={mode === 'scratch' ? describeRef : searchRef}
      footerNote={
        cloning
          ? undefined
          : mode === 'scratch'
            ? 'The empty folder opens as the project and a New project mission sets it up. No remote is created, nothing is pushed.'
            : 'The clone opens as the project when it’s done. Nothing is pushed.'
      }
      footer={
        mode === 'scratch' ? (
          <>
            <button type="button" className="btn ghost" disabled={starting} onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={!canStart}>
              <Rocket size={13} /> {starting ? 'Starting…' : 'Create and start'}
            </button>
          </>
        ) : cloning ? (
          <button type="button" className="btn" onClick={() => void window.api.git.cloneCancel(cloning.id)}>
            Cancel clone
          </button>
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={!canClone}>
              <GitFork size={13} /> Clone
            </button>
          </>
        )
      }
    >
      <div className="np-choices" role="radiogroup" aria-label="How to start">
        <button type="button" role="radio" aria-checked={mode === 'clone'} className={`np-choice${mode === 'clone' ? ' on' : ''}`} disabled={!!cloning || starting} onClick={() => (setMode('clone'), setError(''))}>
          <GitFork size={15} />
          <span>
            <b>Clone from GitHub</b>
            <span className="muted small">One of your repositories, or any git URL</span>
          </span>
        </button>
        <button type="button" role="radio" aria-checked={mode === 'scratch'} className={`np-choice${mode === 'scratch' ? ' on' : ''}`} disabled={!!cloning || starting} onClick={() => (setMode('scratch'), setError(''))}>
          <Sparkles size={15} />
          <span>
            <b>Start from scratch</b>
            <span className="muted small">An empty project, set up by an agent</span>
          </span>
        </button>
      </div>

      {mode === 'scratch' ? (
        <>
          <label className="field">
            <span>Describe the project</span>
            <textarea
              ref={describeRef}
              className="np-describe"
              rows={4}
              value={description}
              disabled={starting}
              placeholder={getKind('new-project').placeholder}
              onChange={(e) => setDescription(e.target.value)}
            />
            <span className="field-hint">What it is and the stack, if you have one in mind. The agent runs the stack’s own generator and adds a README, license, build and test commands, CI and a first commit.</span>
          </label>
          <div className="field-row">
            <label className="field">
              <span>Agent</span>
              <select value={agent.id} disabled={starting} onChange={(e) => (setAgentId(e.target.value), setModel(null))}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.installed === false ? ' (not installed)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="field np-model">
              <span>Model</span>
              <input
                className="mono"
                value={shownModel}
                disabled={starting}
                spellCheck={false}
                list={agent.models.length ? 'np-models' : undefined}
                placeholder={agent.modelPlaceholder ?? 'default'}
                onChange={(e) => setModel(e.target.value)}
              />
              {agent.models.length > 0 && (
                <datalist id="np-models">
                  {agent.models.map((m) => <option key={m} value={m} />)}
                </datalist>
              )}
              <span className="field-hint">
                {cheap
                  ? shownModel.trim() === cheap
                    ? `${agent.name}’s low-cost model: setting up is routine work. Change it in Settings → Agents.`
                    : shownModel.trim()
                      ? `Instead of ${agent.name}’s low-cost model (${cheap}).`
                      : `Empty uses ${agent.name}’s low-cost model (${cheap}).`
                  : `${agent.name} has no low-cost model set, so it uses its default. Set one in Settings → Agents.`}
              </span>
            </label>
            <label className="field np-license">
              <span>License</span>
              <select value={license} disabled={starting} onChange={(e) => setLicense(e.target.value as NewProjectLicense)}>
                {NEW_PROJECT_LICENSES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          </div>
        </>
      ) : (
        <>

      <label className="field">
        <span>Repository</span>
        <input
          ref={searchRef}
          className="np-search"
          value={query}
          disabled={!!cloning}
          placeholder="Search your repositories, or paste a URL or owner/name"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <div className="np-repos" role="listbox" aria-label="Your repositories">
        {pasted && (
          <div className="np-repo on np-pasted" role="option" aria-selected>
            <Link2 size={13} />
            <span className="np-repo-main">
              <b className="mono">{pasted.url}</b>
              <span className="muted small">Cloned with git, as pasted</span>
            </span>
          </div>
        )}
        {list.loading ? (
          <Loading what="Reading your repositories from GitHub…" />
        ) : list.error ? (
          <Empty title="Your repositories can’t be listed" hint={<>{list.error} You can still paste a URL above: it clones with git.</>} action={<button type="button" className="btn sm" onClick={loadList}>Retry</button>} />
        ) : list.repos.length === 0 ? (
          <Empty title="No repositories on your GitHub account" hint="Paste a URL above to clone one from anywhere." />
        ) : repos.length === 0 ? (
          !pasted && <Empty title={`No repository matches “${query.trim()}”`} hint="Paste a URL or owner/name to clone one that isn’t yours." />
        ) : (
          repos.map((r) => (
            <button
              key={r.nameWithOwner}
              type="button"
              role="option"
              aria-selected={source?.url === r.url}
              className={`np-repo${source?.url === r.url ? ' on' : ''}`}
              disabled={!!cloning}
              onClick={() => setPicked({ url: r.url, name: repoFolderName(r.nameWithOwner) })}
            >
              {r.isPrivate ? <Lock size={13} aria-label="Private" /> : <FolderGit2 size={13} />}
              <span className="np-repo-main">
                <b>{r.nameWithOwner}</b>
                {r.description && <span className="muted small">{r.description}</span>}
              </span>
              <span className="muted small np-repo-when">{ago(r.updatedAt)}</span>
            </button>
          ))
        )}
      </div>

        </>
      )}

      <div className="field-row">
        <label className="field">
          <span>Parent folder</span>
          <div className="np-parent">
            <input value={parent} disabled={!!cloning || starting} onChange={(e) => setParent(e.target.value)} spellCheck={false} />
            <button type="button" className="btn" disabled={!!cloning || starting} onClick={() => void browse()}>
              <FolderOpen size={13} /> Browse…
            </button>
          </div>
          <span className="field-hint">Remembered for the next new project.</span>
        </label>
        {mode === 'scratch' ? (
          <label className="field np-name">
            <span>Name</span>
            <input value={projectName} disabled={starting} spellCheck={false} placeholder={description.trim() ? projectSlug(description) : 'optional'} onChange={(e) => setProjectName(e.target.value)} />
            <span className={`field-hint${problem ? ' np-problem' : ''}`} role={problem ? 'alert' : undefined}>
              {problem ?? (target ? `Creates ${target.dest}` : 'Optional: without one the agent suggests a repository name.')}
            </span>
          </label>
        ) : (
          <label className="field np-name">
            <span>Folder name</span>
            <input
              value={name}
              disabled={!!cloning}
              spellCheck={false}
              placeholder="repository name"
              onChange={(e) => {
                setName(e.target.value)
                setNameEdited(e.target.value !== '')
              }}
            />
            <span className={`field-hint${problem ? ' np-problem' : ''}`} role={problem ? 'alert' : undefined}>
              {problem ?? (target ? `Clones into ${target.dest}` : 'Defaults to the repository’s name.')}
            </span>
          </label>
        )}
      </div>

      {cloning && (
        <div className="np-progress" role="status" aria-live="polite">
          <div className="np-progress-head">
            <span>{progress?.phase ?? 'Starting git clone'}…</span>
            {progress?.percent != null && <span className="mono">{progress.percent}%</span>}
          </div>
          <div className="np-bar">
            <div className={`np-bar-fill${progress?.percent == null ? ' indeterminate' : ''}`} style={progress?.percent != null ? { width: `${progress.percent}%` } : undefined} />
          </div>
        </div>
      )}
      {error && (mode === 'scratch' ? <ErrorBanner onRetry={() => void start()}>Couldn’t start the project: {error}</ErrorBanner> : <ErrorBanner onRetry={() => void clone()}>Couldn’t clone: {error}</ErrorBanner>)}
    </Modal>
  )
}
