import { useEffect, useRef, useState } from 'react'
import { FolderGit2, FolderOpen, GitFork, Link2, Lock, Sparkles } from 'lucide-react'
import { cloneProgress, filterRepos, folderNameProblem, parseCloneInput, repoFolderName, type CloneSource, type GhRepoList } from '@shared/newProject'
import { createStore, useStore } from '../state/store'
import { setRootFolder, updateSettings, workspace } from '../state/workspace'
import { dirname } from '../lib/paths'
import { errText } from '../lib/removals'
import { Modal } from './Modal'
import { Empty, ErrorBanner, Loading } from './States'
import { toast } from './Toast'

const dialog = createStore<{ open: boolean; n: number }>({ open: false, n: 0 })

/** New project…: clone a repository (and, once it lands, start one from scratch) */
export function openNewProject(): void {
  dialog.set({ open: true, n: dialog.get().n + 1 })
}

export function NewProjectHost(): React.JSX.Element | null {
  const s = useStore(dialog, (d) => d)
  if (!s.open) return null
  return <NewProjectDialog key={s.n} onClose={() => dialog.set({ open: false, n: s.n })} />
}

type ListState = { loading: true } | ({ loading: false } & GhRepoList)

const ago = (iso: string): string => {
  const t = Date.parse(iso)
  if (!t) return ''
  const d = Math.floor((Date.now() - t) / 86400000)
  return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 60 ? `${d} days ago` : d < 730 ? `${Math.floor(d / 30)} months ago` : `${Math.floor(d / 365)} years ago`
}

function NewProjectDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
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

  // the target is checked as it's typed, and again just before cloning (in main)
  useEffect(() => {
    if (!parent || !name) return setTarget(null)
    let live = true
    const t = setTimeout(() => void window.api.git.cloneTarget(parent, name).then((r) => live && setTarget(r)), 150)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [parent, name])

  useEffect(() => {
    if (!cloning) return
    return window.api.git.onCloneOutput((id, text) => setCloning((c) => (c && c.id === id ? { ...c, output: (c.output + text).slice(-8000) } : c)))
  }, [cloning?.id])

  const nameProblem = name ? folderNameProblem(name) : null
  const problem = nameProblem ?? target?.problem ?? null
  const canClone = !!source && !!parent && !!name && !problem && !!target && !cloning

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
      busy={!!cloning}
      onClose={onClose}
      onSubmit={() => void clone()}
      initialFocus={searchRef}
      footerNote={cloning ? undefined : 'The clone opens as the project when it’s done. Nothing is pushed.'}
      footer={
        cloning ? (
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
        <button type="button" role="radio" aria-checked className="np-choice on">
          <GitFork size={15} />
          <span>
            <b>Clone from GitHub</b>
            <span className="muted small">One of your repositories, or any git URL</span>
          </span>
        </button>
        <button type="button" role="radio" aria-checked={false} className="np-choice" disabled title="Coming next">
          <Sparkles size={15} />
          <span>
            <b>Start from scratch</b>
            <span className="muted small">An empty project, set up by an agent</span>
          </span>
          <span className="chip">coming next</span>
        </button>
      </div>

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

      <div className="field-row">
        <label className="field">
          <span>Parent folder</span>
          <div className="np-parent">
            <input value={parent} disabled={!!cloning} onChange={(e) => setParent(e.target.value)} spellCheck={false} />
            <button type="button" className="btn" disabled={!!cloning} onClick={() => void browse()}>
              <FolderOpen size={13} /> Browse…
            </button>
          </div>
          <span className="field-hint">Remembered for the next clone.</span>
        </label>
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
      {error && <ErrorBanner onRetry={() => void clone()}>Couldn’t clone: {error}</ErrorBanner>}
    </Modal>
  )
}
