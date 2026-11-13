import { useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Cloud, Copy, GitBranch, GitBranchPlus, LoaderCircle, Search, SquareTerminal, X } from 'lucide-react'
import type { GitBranchList, GitBranchRef } from '@shared/types'
import { BRANCH_LIMIT, branchNameProblem, branchSlice } from '@shared/git'
import { gitCreateBranch, gitFolds, gitState, gitSwitch } from '../state/git'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { openTerminal } from '../dock/dockApi'
import { showContextMenu, type MenuItem } from './ContextMenu'
import { Modal } from './Modal'
import { ErrorBanner } from './States'
import { TimeAgo } from './TimeAgo'
import { toast } from './Toast'

/** "origin/feature/x" → "feature/x": the local name a remote branch would get */
const localName = (remote: string): string => remote.slice(remote.indexOf('/') + 1)

const copyName = (name: string): void => void navigator.clipboard.writeText(name).then(() => toast(`Copied ${name}`))

/** Where a branch is checked out: this folder when it's current, another worktree, or nowhere. */
function checkedOutAt(b: GitBranchRef, root: string): string | null {
  return b.current ? root : b.worktree
}

/** Branches of the open folder: local ones to switch to, remote ones (folded) to branch from, and New branch. */
export function GitBranches({ branches }: { branches: GitBranchList }): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder) ?? ''
  const busy = useStore(gitState, (s) => s.busy)
  const folds = useStore(gitFolds, (s) => s)
  const [all, setAll] = useState({ local: false, remote: false })
  const [switching, setSwitching] = useState<string | null>(null)
  const [create, setCreate] = useState<{ base: string; name: string } | null>(null)

  const switchTo = (b: GitBranchRef): void => {
    if (b.current || busy) return
    setSwitching(b.name)
    void gitSwitch(b.name).finally(() => setSwitching(null))
  }

  const localMenu = (b: GitBranchRef): MenuItem[] => {
    const at = checkedOutAt(b, root)
    return [
      { label: b.current ? 'Current branch' : 'Switch to it', icon: <Check size={13} />, disabled: b.current || !!busy, run: () => switchTo(b) },
      { label: 'New branch from here…', icon: <GitBranchPlus size={13} />, run: () => setCreate({ base: b.name, name: '' }) },
      { type: 'separator' },
      { label: 'Copy name', icon: <Copy size={13} />, run: () => copyName(b.name) },
      {
        label: at ? 'Open terminal here' : 'Open terminal here (not checked out)',
        icon: <SquareTerminal size={13} />,
        disabled: !at,
        run: () => at && openTerminal({ cwd: at, title: b.name })
      }
    ]
  }

  const remoteMenu = (b: GitBranchRef): MenuItem[] => [
    { label: 'New branch from here…', icon: <GitBranchPlus size={13} />, run: () => setCreate({ base: b.name, name: localName(b.name) }) },
    { type: 'separator' },
    { label: 'Copy name', icon: <Copy size={13} />, run: () => copyName(b.name) }
  ]

  return (
    <section className="git-branches" data-testid="git-branches">
      <div className="git-section-head">
        <span className="label">Branches</span>
        <span className="git-muted git-count">{branches.local.length + branches.remote.length}</span>
        <button type="button" className="icon-btn" title="New branch" aria-label="New branch" data-testid="git-new-branch" onClick={() => setCreate({ base: '', name: '' })}>
          <GitBranchPlus size={14} />
        </button>
      </div>
      {branches.local.length + branches.remote.length > 0 && (
        <label className="git-search">
          <Search size={12} />
          <input
            value={folds.query}
            placeholder="Find a branch"
            spellCheck={false}
            aria-label="Find a branch"
            data-testid="git-branch-search"
            onChange={(e) => gitFolds.set({ query: e.target.value })}
            onKeyDown={(e) => e.key === 'Escape' && folds.query && (e.stopPropagation(), gitFolds.set({ query: '' }))}
          />
          {folds.query && (
            <button type="button" className="icon-btn" title="Clear the search" aria-label="Clear the search" onClick={() => gitFolds.set({ query: '' })}>
              <X size={12} />
            </button>
          )}
        </label>
      )}
      {branches.local.length === 0 ? (
        <div className="git-hint">No branches yet: make a first commit, then branches show here.</div>
      ) : (
        <BranchGroup
          kind="local"
          list={branches.local}
          query={folds.query}
          open={folds.local}
          showAll={all.local}
          onShowAll={() => setAll((a) => ({ ...a, local: true }))}
          render={(b) => (
            <button
              type="button"
              className={`git-branch-row${b.current ? ' current' : ''}`}
              data-branch={b.name}
              aria-current={b.current || undefined}
              disabled={!!busy && !b.current}
              title={b.current ? `${b.name} (checked out)${b.subject ? `\n${b.subject}` : ''}` : `Switch to ${b.name}${b.worktree ? `\nChecked out in ${b.worktree}` : ''}${b.subject ? `\n${b.subject}` : ''}`}
              onClick={() => switchTo(b)}
              onContextMenu={(e) => showContextMenu(e, localMenu(b))}
            >
              {switching === b.name ? <LoaderCircle size={13} className="spin" /> : b.current ? <Check size={13} className="git-current-mark" /> : <GitBranch size={13} />}
              <span className="git-row-name">{b.name}</span>
              {b.worktree && <span className="chip git-wt-chip" title={`Checked out in ${b.worktree}`}>worktree</span>}
              {b.committedAt > 0 && <TimeAgo t={b.committedAt} className="git-row-time" />}
            </button>
          )}
        />
      )}

      {branches.remote.length > 0 && (
        <BranchGroup
          kind="remote"
          list={branches.remote}
          query={folds.query}
          open={folds.remote}
          showAll={all.remote}
          onShowAll={() => setAll((a) => ({ ...a, remote: true }))}
          render={(b) => (
            <button
              type="button"
              className="git-branch-row"
              data-remote-branch={b.name}
              title={`New branch from ${b.name}${b.subject ? `\n${b.subject}` : ''}`}
              onClick={() => setCreate({ base: b.name, name: localName(b.name) })}
              onContextMenu={(e) => showContextMenu(e, remoteMenu(b))}
            >
              <Cloud size={13} />
              <span className="git-row-name">{b.name}</span>
              {b.committedAt > 0 && <TimeAgo t={b.committedAt} className="git-row-time" />}
            </button>
          )}
        />
      )}

      {create && <NewBranchDialog branches={branches} initialBase={create.base} initialName={create.name} onClose={() => setCreate(null)} />}
    </section>
  )
}

/**
 * Local or remote branches under a fold: the BRANCH_LIMIT most recent (Show all for the rest), or, while
 * searching, the matches, opened whatever the fold says so a search never comes up empty behind it.
 */
function BranchGroup(p: {
  kind: 'local' | 'remote'
  list: GitBranchRef[]
  query: string
  open: boolean
  showAll: boolean
  onShowAll: () => void
  render: (b: GitBranchRef) => React.JSX.Element
}): React.JSX.Element {
  const searching = !!p.query.trim()
  const { shown, matched } = branchSlice(p.list, p.query, p.showAll ? Infinity : BRANCH_LIMIT)
  const open = searching ? matched > 0 : p.open
  const label = p.kind === 'local' ? 'Local' : 'Remote'
  const left = matched - shown.length
  return (
    <div className="git-branch-group" data-group={p.kind}>
      <button type="button" className="git-fold" aria-expanded={open} data-testid={`git-${p.kind}-toggle`} disabled={searching} onClick={() => gitFolds.set({ [p.kind]: !p.open })}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>{label}</span>
        <span className="git-muted git-count">{searching ? `${matched} of ${p.list.length}` : p.list.length}</span>
      </button>
      {open && (
        <>
          <ul className="git-branch-list" aria-label={`${label} branches`}>
            {shown.map((b) => (
              <li key={b.name}>{p.render(b)}</li>
            ))}
          </ul>
          {left > 0 && (
            <div className="git-more">
              <span className="git-hint">{left} older {searching ? 'matches' : `branch${left === 1 ? '' : 'es'}`} hidden{searching ? '' : ', search to find one'}</span>
              <button type="button" className="btn sm ghost" data-testid={`git-${p.kind}-all`} onClick={p.onShowAll}>
                Show all
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function NewBranchDialog({ branches, initialBase, initialName, onClose }: { branches: GitBranchList; initialBase: string; initialName: string; onClose: () => void }): React.JSX.Element {
  const current = branches.local.find((b) => b.current)?.name ?? null
  const [name, setName] = useState(initialName)
  // '' = the current branch (HEAD); kept as '' so a detached HEAD works too
  const [base, setBase] = useState(initialBase === current ? '' : initialBase)
  const [switchTo, setSwitchTo] = useState(true)
  const [touched, setTouched] = useState(!!initialName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  const problem = branchNameProblem(name, branches.local.map((b) => b.name))
  const showProblem = touched && problem

  const submit = async (): Promise<void> => {
    setTouched(true)
    if (problem) {
      nameRef.current?.focus()
      return
    }
    setBusy(true)
    setError('')
    const err = await gitCreateBranch(name.trim(), base, switchTo)
    setBusy(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <Modal
      title="New branch"
      size="sm"
      onClose={onClose}
      busy={busy}
      initialFocus={nameRef}
      onSubmit={() => void submit()}
      footerNote="Nothing is pushed."
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || (touched && !!problem)} data-testid="git-create-branch">
            {busy ? <LoaderCircle size={13} className="spin" /> : <GitBranchPlus size={13} />} {busy ? 'Creating…' : 'Create branch'}
          </button>
        </>
      }
    >
      <div className="git-new-branch">
        <label className="field">
          <span>Name</span>
          <input
            ref={nameRef}
            className="mono"
            value={name}
            placeholder="feature/login-form"
            spellCheck={false}
            aria-invalid={!!showProblem}
            data-testid="git-branch-name"
            onChange={(e) => {
              setName(e.target.value)
              setTouched(true)
              setError('')
            }}
          />
          {showProblem ? (
            <div className="field-hint tone-error" data-testid="git-branch-name-problem">{problem}</div>
          ) : (
            <div className="field-hint">Slashes group branches, like feature/… or fix/….</div>
          )}
        </label>
        <label className="field">
          <span>Based on</span>
          <select value={base} onChange={(e) => setBase(e.target.value)} data-testid="git-branch-base">
            <option value="">{current ? `${current} (current)` : 'Current commit (HEAD)'}</option>
            {branches.local.some((b) => !b.current) && (
              <optgroup label="Local">
                {branches.local.filter((b) => !b.current).map((b) => (
                  <option key={b.name} value={b.name}>{b.name}</option>
                ))}
              </optgroup>
            )}
            {branches.remote.length > 0 && (
              <optgroup label="Remote">
                {branches.remote.map((b) => (
                  <option key={b.name} value={b.name}>{b.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          <div className="field-hint">The new branch starts at this branch's last commit. It doesn't track it.</div>
        </label>
        <label className="check">
          <input type="checkbox" checked={switchTo} onChange={(e) => setSwitchTo(e.target.checked)} data-testid="git-branch-switch" />
          <span>Switch to it</span>
        </label>
        <div className="field-hint">{switchTo ? 'Uncommitted changes come along to the new branch.' : 'You stay on the branch you are on.'}</div>
        {error && <ErrorBanner><pre className="git-error">{error}</pre></ErrorBanner>}
      </div>
    </Modal>
  )
}
