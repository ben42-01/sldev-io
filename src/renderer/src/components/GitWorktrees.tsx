import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Code2, Eraser, FolderGit2, FolderOpen, Lock, Plus, SquareTerminal, Trash2 } from 'lucide-react'
import type { GitWorktree } from '@shared/types'
import { gitFolds, gitState, pruneWorktrees, refreshGit, usersOf, worktreeInfo } from '../state/git'
import { missions } from '../state/missions'
import { factory, runWorktrees } from '../state/factory'
import { evals } from '../state/evals'
import { useStore } from '../state/store'
import { preferredEditor } from '../state/workspace'
import { openTerminal } from '../dock/dockApi'
import { openInEditor } from '../lib/actions'
import { worktreeSummary, type WorktreeUser } from '../lib/git'
import { basename, dirname } from '../lib/paths'
import { errText, removeWorktreeFlow, worktreeBlockers } from '../lib/removals'
import { Modal } from './Modal'
import { ErrorBanner } from './States'
import { toast } from './Toast'

/**
 * The Git view's Worktrees section: every worktree of the repository (the main checkout first), what
 * each has that isn't committed or merged, and which mission, factory run or eval works in it.
 */
export function WorktreesSection({ root }: { root: string }): React.JSX.Element {
  const list = useStore(gitState, (s) => s.worktrees)
  const error = useStore(gitState, (s) => s.worktreesError)
  const statuses = useStore(gitState, (s) => s.wtStatus)
  // re-render when what uses a worktree changes (a mission starts or stops)
  const ms = useStore(missions, (s) => s.list)
  const runs = useStore(factory, (s) => s.runs)
  const evalRuns = useStore(evals, (s) => s.runs)
  const [creating, setCreating] = useState(false)
  const open = useStore(gitFolds, (s) => s.worktrees)
  // a mission, run or eval that makes (or drops) a worktree while this is open: list again
  const owned = [...ms.map((m) => m.worktree?.path), ...runs.flatMap((r) => runWorktrees(r).map((w) => w.path)), ...evalRuns.flatMap((r) => r.attempts.map((a) => a.worktree?.path))]
    .filter(Boolean)
    .sort()
    .join('\n')
  const first = useRef(true)
  useEffect(() => {
    if (first.current) first.current = false
    else void refreshGit()
  }, [owned])

  const prunable = list?.some((w) => w.prunable) ?? false
  return (
    <section className="git-wt" data-testid="git-worktrees">
      <div className="git-wt-head">
        <button type="button" className="git-fold git-wt-fold" aria-expanded={open} data-testid="git-worktrees-toggle" onClick={() => gitFolds.set({ worktrees: !open })}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="label">Worktrees</span>
          {list && <span className="git-muted git-count">{list.length}</span>}
        </button>
        <div className="git-wt-head-actions">
          {prunable && (
            <button className="icon-btn" title="Prune: forget worktrees whose folders are gone (their branches stay)" aria-label="Prune worktrees" onClick={() => void pruneWorktrees()}>
              <Eraser size={14} />
            </button>
          )}
          <button className="icon-btn" title="New worktree" aria-label="New worktree" onClick={() => (gitFolds.set({ worktrees: true }), setCreating(true))}>
            <Plus size={14} />
          </button>
        </div>
      </div>
      {!open ? null : error ? (
        <ErrorBanner onRetry={() => void refreshGit()}>Couldn't list the worktrees: {error}</ErrorBanner>
      ) : !list ? (
        <div className="git-muted git-wt-loading">Reading worktrees…</div>
      ) : (
        <ul className="git-wt-list">
          {list.map((w) => (
            <WorktreeRow key={w.path} wt={w} summary={worktreeSummary(statuses[w.path], w.isMain ? undefined : worktreeInfo(w, list).base)} />
          ))}
        </ul>
      )}
      {open && list && list.length === 1 && !error && <div className="git-hint">Only the main checkout. A worktree is a second folder on another branch, so an agent can work there while you work here.</div>}
      {creating && <NewWorktreeDialog root={root} list={list ?? []} onClose={() => setCreating(false)} />}
    </section>
  )
}

function WorktreeRow({ wt, summary }: { wt: GitWorktree; summary: string | null }): React.JSX.Element {
  const users = usersOf(wt)
  const blockers = worktreeBlockers(wt, users)
  const gone = wt.prunable
  const name = wt.branch ?? (wt.bare ? 'bare repository' : wt.head ? `detached at ${wt.head.slice(0, 7)}` : 'detached')
  const editor = preferredEditor()
  const remove = async (): Promise<void> => {
    if (await removeWorktreeFlow(wt, worktreeInfo(wt), usersOf(wt))) {
      toast(`Removed the worktree ${basename(wt.path)}`)
      await refreshGit()
    }
  }
  return (
    <li className={`git-wt-row${gone ? ' gone' : ''}`} data-path={wt.path} data-main={wt.isMain || undefined}>
      <div className="git-wt-line">
        <FolderGit2 size={14} className="git-wt-icon" />
        <span className="git-wt-branch" title={wt.branch ?? wt.head ?? ''}>
          {name}
        </span>
        {wt.isMain && <span className="git-wt-tag">main</span>}
        {wt.locked && (
          <span className="git-wt-tag" title={wt.lockReason ? `Locked: ${wt.lockReason}` : 'Locked'}>
            <Lock size={10} /> locked
          </span>
        )}
        {gone && (
          <span className="git-wt-tag warn" title={wt.prunableReason ?? 'The folder is gone'}>
            folder gone
          </span>
        )}
        <div className="row-actions">
          {gone ? (
            <button className="btn ghost sm" title="git worktree prune: forget worktrees whose folders are gone (their branches stay)" onClick={() => void pruneWorktrees()}>
              Prune
            </button>
          ) : (
            <>
              <button className="icon-btn" title="Open a terminal here" aria-label="Open a terminal here" onClick={() => openTerminal({ cwd: wt.path, title: basename(wt.path) })}>
                <SquareTerminal size={14} />
              </button>
              <button className="icon-btn" title={`Open in ${editor?.name ?? 'default app'}`} aria-label="Open in editor" onClick={() => void openInEditor(wt.path, editor, true)}>
                <Code2 size={14} />
              </button>
              <button className="icon-btn" title="Reveal the folder" aria-label="Reveal the folder" onClick={() => void window.api.shell.reveal(wt.path)}>
                <FolderOpen size={14} />
              </button>
              {!wt.isMain && (
                <button
                  className="icon-btn danger"
                  title={blockers.length ? `Can't remove: ${blockers.join(' ')}` : 'Remove this worktree…'}
                  aria-label="Remove worktree"
                  disabled={blockers.length > 0}
                  onClick={() => void remove()}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="git-wt-path" title={wt.path}>
        {wt.path}
      </div>
      {(summary || users.length > 0) && (
        <div className="git-wt-meta">
          {summary && <span className="git-wt-dirty">{summary}</span>}
          {users.map((u) => (
            <UserChip key={`${u.kind}:${u.id}`} u={u} />
          ))}
        </div>
      )}
      {!wt.isMain && blockers.length > 0 && !gone && <div className="git-wt-why">{blockers[0]}</div>}
    </li>
  )
}

const KIND: Record<WorktreeUser['kind'], string> = { mission: 'Mission', run: 'Run', eval: 'Eval' }

function UserChip({ u }: { u: WorktreeUser }): React.JSX.Element {
  return (
    <span className={`git-wt-user${u.live ? ' live' : ''}`} title={`${KIND[u.kind]}: ${u.label}${u.live ? ' (running)' : ''}`}>
      {u.live && <span className="dot" />}
      {KIND[u.kind]} · {u.label}
    </span>
  )
}

/** New worktree: a new branch from a base, or an existing branch, in ../.sldev-worktrees/<repo>/ like mission worktrees. */
function NewWorktreeDialog({ root, list, onClose }: { root: string; list: GitWorktree[]; onClose: () => void }): React.JSX.Element {
  const main = list.find((w) => w.isMain) ?? list[0]
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [name, setName] = useState('')
  const [base, setBase] = useState(main?.branch ?? '')
  const [local, setLocal] = useState<string[]>([])
  const [remote, setRemote] = useState<string[]>([])
  const [existing, setExisting] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.api.git.branches(root).then(setLocal)
    void window.api.git.remoteBranches(root).then(setRemote, () => setRemote([]))
  }, [root])

  // git checks a branch out in one worktree only
  const checkedOut = new Set(list.map((w) => w.branch).filter(Boolean))
  const free = local.filter((b) => !checkedOut.has(b))
  useEffect(() => {
    if (!existing && free.length) setExisting(free[0])
  }, [free.join('\n')])

  const branch = mode === 'new' ? name.trim() : existing
  const top = main?.path ?? root
  const where = branch ? `${dirname(top)}/.sldev-worktrees/${basename(top)}/${branch.replace(/\//g, '-')}` : ''

  const create = async (): Promise<void> => {
    if (!branch) return
    setBusy(true)
    setError('')
    try {
      const wt = await window.api.git.addWorktree(root, branch, mode === 'new' ? base.trim() : (main?.branch ?? ''), mode === 'new' ? { exact: true } : { existing: true })
      toast(`Created the worktree ${basename(wt.path)} on ${wt.branch}`)
      await refreshGit()
      onClose()
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New worktree"
      size="sm"
      busy={busy}
      onClose={onClose}
      onSubmit={() => void create()}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !branch}>
            {busy ? 'Creating…' : 'Create worktree'}
          </button>
        </>
      }
    >
      <div className="git-wt-form" data-testid="new-worktree">
        <div className="seg" role="group" aria-label="Branch">
          <button type="button" className={mode === 'new' ? 'on' : ''} aria-pressed={mode === 'new'} onClick={() => setMode('new')}>
            New branch
          </button>
          <button type="button" className={mode === 'existing' ? 'on' : ''} aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}>
            Existing branch
          </button>
        </div>
        {mode === 'new' ? (
          <>
            <label className="field">
              <span>Branch name</span>
              <input name="branch" value={name} placeholder="feature/dark-mode" spellCheck={false} onChange={(e) => setName(e.target.value)} />
              <span className="field-hint">Created for this worktree, exactly as written.</span>
            </label>
            <label className="field">
              <span>Base</span>
              <input name="base" list="wt-bases" value={base} placeholder={main?.branch ?? 'HEAD'} spellCheck={false} onChange={(e) => setBase(e.target.value)} />
              <datalist id="wt-bases">
                {[...local, ...remote].map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
              <span className="field-hint">The branch or commit it starts from. Empty: the current branch.</span>
            </label>
          </>
        ) : (
          <label className="field">
            <span>Branch</span>
            {free.length ? (
              <select name="existing" value={existing} onChange={(e) => setExisting(e.target.value)}>
                {free.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            ) : (
              <span className="field-hint">Every local branch is already checked out in a worktree.</span>
            )}
            <span className="field-hint">Branches checked out in another worktree aren't listed: git allows each in one place only.</span>
          </label>
        )}
        {where && (
          <div className="field-hint git-wt-where">
            Folder: <code>{where}</code>
          </div>
        )}
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </div>
    </Modal>
  )
}
