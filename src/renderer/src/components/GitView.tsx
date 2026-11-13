import { useEffect } from 'react'
import { ArrowDown, ArrowDownToLine, ArrowUp, CloudDownload, GitBranch, LoaderCircle, RefreshCw } from 'lucide-react'
import { gitFetch, gitPull, gitState, refreshGit } from '../state/git'
import { changeSummary, gitErrorLine } from '../lib/git'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { ViewShell } from './RuntimesView'
import { Empty, ErrorBanner, Loading } from './States'
import { GitBranches } from './GitBranches'
import { WorktreesSection } from './GitWorktrees'

/** Everyday git for the open folder: where the branch stands, Fetch and Pull (fast-forward only), branches to switch and create. */
export function GitView(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const g = useStore(gitState, (s) => s)

  useEffect(() => {
    void refreshGit()
    const again = (): void => void refreshGit()
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [root])

  const refresh = (
    <button className="icon-btn" title="Refresh" aria-label="Refresh" onClick={() => void refreshGit()}>
      <RefreshCw size={14} className={g.loading ? 'spin' : ''} />
    </button>
  )

  if (!root) {
    return (
      <ViewShell title="Git">
        <Empty icon={<GitBranch size={20} />} title="No folder open" hint="Open a folder that is a git repository to fetch and pull here." />
      </ViewShell>
    )
  }
  // results for another folder are still on screen until the first read of this one
  const current = g.root === root
  const s = current ? g.status : null

  return (
    <ViewShell title="Git" actions={refresh}>
      {current && g.repo === false ? (
        <Empty icon={<GitBranch size={20} />} title="Not a git repository" hint="This folder isn't under git. Open a repository, or run git init in a terminal, to fetch and pull here." />
      ) : current && g.error && !s ? (
        <div className="git-body">
          <ErrorBanner onRetry={() => void refreshGit()}>Couldn't read the git status: {g.error}</ErrorBanner>
        </div>
      ) : !s ? (
        <Loading what="Reading git status…" />
      ) : (
        <div className="git-body" data-testid="git-view">
          <div className="git-head">
            <div className="git-branch" title={s.branch ?? s.head ?? ''}>
              <GitBranch size={14} />
              <span className="git-branch-name">{s.branch ?? (s.head ? `detached at ${s.head.slice(0, 7)}` : 'no commits yet')}</span>
            </div>
            <div className="git-upstream">
              {s.upstream ? (
                <>
                  <span className="git-upstream-name" title="Upstream">{s.upstream}</span>
                  <span className={`git-ab${s.ahead ? ' on' : ''}`} title={`${s.ahead} ahead of ${s.upstream}`} data-ahead={s.ahead}>
                    <ArrowUp size={12} /> {s.ahead}
                  </span>
                  <span className={`git-ab${s.behind ? ' on' : ''}`} title={`${s.behind} behind ${s.upstream}`} data-behind={s.behind}>
                    <ArrowDown size={12} /> {s.behind}
                  </span>
                </>
              ) : (
                <span className="git-muted">{s.detached ? 'Detached HEAD: nothing to pull into' : 'No upstream: this branch tracks no remote branch'}</span>
              )}
            </div>
            <div className="git-changes" data-testid="git-changes">
              {changeSummary(s) ?? <span className="git-muted">Working tree clean</span>}
            </div>
          </div>

          <div className="git-actions">
            <button className="btn" disabled={!!g.busy} onClick={() => void gitFetch()} title="git fetch --all --prune: download what's new on every remote; your branch is not changed">
              {g.busy === 'fetch' ? <LoaderCircle size={13} className="spin" /> : <CloudDownload size={13} />} {g.busy === 'fetch' ? 'Fetching…' : 'Fetch'}
            </button>
            <button
              className="btn primary"
              disabled={!!g.busy || !s.upstream}
              onClick={() => void gitPull()}
              title={s.upstream ? `git pull --ff-only: move ${s.branch} up to ${s.upstream}; never merges or rebases` : 'This branch has no upstream to pull from'}
            >
              {g.busy === 'pull' ? <LoaderCircle size={13} className="spin" /> : <ArrowDownToLine size={13} />} {g.busy === 'pull' ? 'Pulling…' : 'Pull'}
            </button>
          </div>
          <div className="git-hint">Pull only fast-forwards. A branch that has diverged is left as it is, for you to merge or rebase.</div>

          {g.actionError && (
            <ErrorBanner>
              <strong>
                {g.actionError.action === 'switch' ? `Couldn't switch to ${g.actionError.branch}` : g.actionError.action === 'fetch' ? 'Fetch failed' : 'Pull failed'}: {gitErrorLine(g.actionError.message)}
              </strong>
              {g.actionError.action === 'switch' && <div className="git-hint">Nothing changed: you are still on {s.branch ?? 'the same commit'}.</div>}
              <pre className="git-error">{g.actionError.message}</pre>
            </ErrorBanner>
          )}
          {g.error && <ErrorBanner onRetry={() => void refreshGit()}>Couldn't refresh the git status: {g.error}</ErrorBanner>}
          {g.branches && <GitBranches branches={g.branches} />}

          <WorktreesSection root={root} />
        </div>
      )}
    </ViewShell>
  )
}
