import { useCallback, useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { ExternalLink, GitBranch, GitCommitHorizontal, ChartColumn, RefreshCw, Star, GitFork, Wrench } from 'lucide-react'
import type { RepoStats } from '@shared/types'
import { ghRunSignal } from '@shared/status'
import { openPanel } from './dockApi'
import { workspace } from '../state/workspace'
import { useStore } from '../state/store'
import { openSetup } from '../state/setup'
import { branchPrsLine, branchSummary, countTile, needsGhSetup, statsLinks, STATS_REFRESH_MS } from '../lib/repoStats'
import { Empty, ErrorBanner, Loading } from '../components/States'
import { StatusDot, StatusPill } from '../components/StatusDot'
import { TimeAgo } from '../components/TimeAgo'
import { showNotice } from '../components/Modal'

export function openGitHubStats(): void {
  if (!workspace.get().rootFolder) return void showNotice('No folder open', 'Open a git repository to see its GitHub stats.')
  openPanel('github-stats', 'github-stats', 'GitHub stats')
}

const open = (url: string | null | undefined): void => {
  if (url) void window.api.shell.openExternal(url)
}

type Load = { root: string; state: 'loading' } | { root: string; state: 'error'; message: string } | { root: string; state: 'ready'; data: RepoStats; at: number }

/** Repo health at a glance (what scripts/gh-stats.sh prints), as tiles. Reads only while the tab is on screen. */
export function GitHubStatsPanel(props: IDockviewPanelProps): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const [load, setLoad] = useState<Load | null>(null)
  const [busy, setBusy] = useState(false)
  const [visible, setVisible] = useState(props.api.isVisible)
  const inflight = useRef(false)

  useEffect(() => {
    const d = props.api.onDidVisibilityChange((e) => setVisible(e.isVisible))
    return () => d.dispose()
  }, [props.api])

  const refresh = useCallback(async (): Promise<void> => {
    if (!root || inflight.current) return
    inflight.current = true
    setBusy(true)
    setLoad((l) => (l?.root === root ? l : { root, state: 'loading' }))
    try {
      const data = await window.api.gh.stats(root)
      setLoad({ root, state: 'ready', data, at: Date.now() })
    } catch (e) {
      setLoad({ root, state: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }, [root])

  // read on show, then every minute while shown; a hidden tab (or a minimised window) asks nothing
  useEffect(() => {
    if (!visible || !root) return
    void refresh()
    const timer = setInterval(() => {
      if (!document.hidden) void refresh()
    }, STATS_REFRESH_MS)
    return () => clearInterval(timer)
  }, [visible, root, refresh])

  const refreshBtn = (
    <button className="icon-btn" title="Refresh" aria-label="Refresh" disabled={busy || !root} onClick={() => void refresh()}>
      <RefreshCw size={14} className={busy ? 'spin' : ''} />
    </button>
  )

  if (!root) {
    return (
      <div className="panel-page ghs">
        <Empty big icon={<ChartColumn size={22} />} title="No folder open" hint="Open a git repository to see its pull requests, issues, releases and CI here." />
      </div>
    )
  }
  const current = load?.root === root ? load : null

  return (
    <div className="panel-page ghs" data-testid="github-stats">
      <div className="panel-page-head ghs-head">
        <h2>GitHub stats</h2>
        {current?.state === 'ready' && current.data.github.value && (
          <button className="ghs-repo" title={`Open ${current.data.github.value.url}`} onClick={() => open(current.data.github.value?.url)}>
            {current.data.github.value.repo} <ExternalLink size={11} />
          </button>
        )}
        {current?.state === 'ready' && current.data.github.value && (
          <span className="ghs-meta">
            <span title="Stars"><Star size={11} /> {current.data.github.value.stars}</span>
            <span title="Forks"><GitFork size={11} /> {current.data.github.value.forks}</span>
          </span>
        )}
        <span className="ghs-spacer" />
        {current?.state === 'ready' && (
          <span className="ghs-updated">
            Updated <TimeAgo t={current.at} className="" />
          </span>
        )}
        {refreshBtn}
      </div>

      {!current || current.state === 'loading' ? (
        <Loading what="Reading git and GitHub…" />
      ) : current.state === 'error' ? (
        <ErrorBanner onRetry={() => void refresh()}>Couldn't read the stats: {current.message}</ErrorBanner>
      ) : (
        <Stats s={current.data} />
      )}
    </div>
  )
}

function Stats({ s }: { s: RepoStats }): React.JSX.Element {
  const links = statsLinks(s)
  const gh = s.github.value
  const branch = branchSummary(s)
  const prs = countTile(s.github, gh?.openPrs)
  const issues = countTile(s.github, gh?.openIssues)
  const rel = s.release.value
  const commit = s.lastCommit.value
  const runs = s.runs.value
  const st = s.status.value

  if (s.status.error && s.lastCommit.error && !gh) {
    return <Empty icon={<GitBranch size={20} />} title="Not a git repository" hint={`This folder isn't under git (${s.status.error}).`} />
  }

  return (
    <>
      {needsGhSetup(s) && (
        <div className="banner ghs-setup" data-testid="ghs-setup">
          <div>
            <strong>GitHub tiles need the GitHub CLI.</strong> {s.githubError} Branch and commit below are read from git.
          </div>
          <button className="btn sm" onClick={openSetup}>
            <Wrench size={12} /> Set up gh
          </button>
        </div>
      )}

      <div className="dash-tiles ghs-tiles">
        <Tile testid="branch" label="Branch" value={branch.value} sub={branch.sub} small />
        {!needsGhSetup(s) && (
          <>
            <Tile testid="prs" label="Open PRs" value={prs.value} sub={prs.failed ? "Couldn't read" : branchPrsLine(s)} title={prs.why} href={links?.pulls} />
            <Tile testid="issues" label="Open issues" value={issues.value} sub={issues.failed ? "Couldn't read" : gh?.defaultBranch ? `default branch ${gh.defaultBranch}` : ''} title={issues.why} href={links?.issues} />
            <Tile
              testid="release"
              label="Latest release"
              value={rel ? rel.tag : '—'}
              sub={s.release.error ? "Couldn't read" : rel ? (rel.publishedAt ? new Date(rel.publishedAt).toLocaleDateString() : 'unpublished') + (rel.prerelease ? ' · pre-release' : '') : 'No releases yet'}
              title={s.release.error}
              href={links?.release ?? (rel ? links?.releases : undefined)}
              small
            />
          </>
        )}
      </div>

      <div className="ghs-cards">
        <section className="dash-card ghs-card" data-testid="ghs-commit">
          <div className="dash-card-head">
            <h3>Last commit</h3>
            {links?.commit && <LinkBtn href={links.commit} label="Open the commit on GitHub" />}
          </div>
          {s.lastCommit.error ? (
            <div className="ghs-muted">Couldn't read it: {s.lastCommit.error}</div>
          ) : !commit ? (
            <div className="ghs-muted">No commits yet</div>
          ) : (
            <div className="ghs-commit">
              <GitCommitHorizontal size={14} />
              <code>{commit.short}</code>
              <span className="ghs-commit-subject" title={commit.subject}>{commit.subject}</span>
              <span className="ghs-muted">
                {commit.author} · <TimeAgo t={Date.parse(commit.date)} className="" />
              </span>
            </div>
          )}
        </section>

        {!needsGhSetup(s) && (
          <section className="dash-card ghs-card" data-testid="ghs-runs">
            <div className="dash-card-head">
              <h3>Last CI runs{st?.branch ? <span className="ghs-muted"> on {st.branch}</span> : null}</h3>
              {links && <LinkBtn href={links.actions} label="Open Actions on GitHub" />}
            </div>
            {s.runs.error ? (
              <div className="ghs-muted">Couldn't read the runs: {s.runs.error}</div>
            ) : !runs?.length ? (
              <div className="ghs-muted">No workflow runs{st?.branch ? ' for this branch' : ''}</div>
            ) : (
              <ul className="ghs-runs">
                {runs.map((r) => {
                  const sig = ghRunSignal(r)
                  return (
                    <li key={r.databaseId}>
                      <button className="ghs-run" title={`Open run #${r.number} on GitHub`} onClick={() => open(r.url)} disabled={!r.url}>
                        <StatusDot signal={sig} />
                        <span className="ghs-run-title">{r.displayTitle}</span>
                        <span className="ghs-muted">{r.workflowName} · #{r.number}</span>
                        <span className="ghs-spacer" />
                        <StatusPill signal={sig} />
                        {r.createdAt && <TimeAgo t={Date.parse(r.createdAt)} className="ghs-muted" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )}

        {!needsGhSetup(s) && !!s.branchPrs.value?.length && (
          <section className="dash-card ghs-card" data-testid="ghs-branch-prs">
            <div className="dash-card-head">
              <h3>Pull requests for {st?.branch}</h3>
            </div>
            <ul className="ghs-runs">
              {s.branchPrs.value.map((p) => (
                <li key={p.number}>
                  <button className="ghs-run" title={`Open #${p.number} on GitHub`} onClick={() => open(p.url)}>
                    <span className="ghs-muted">#{p.number}</span>
                    <span className="ghs-run-title">{p.title}</span>
                    <span className="ghs-spacer" />
                    {p.isDraft && <span className="ghs-chip">Draft</span>}
                    <ExternalLink size={11} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}

function LinkBtn({ href, label }: { href: string; label: string }): React.JSX.Element {
  return (
    <button className="icon-btn" title={label} aria-label={label} onClick={() => open(href)}>
      <ExternalLink size={13} />
    </button>
  )
}

function Tile(p: { testid: string; label: string; value: string; sub: string; title?: string; href?: string | null; small?: boolean }): React.JSX.Element {
  const body = (
    <>
      <span className="dash-tile-label">
        {p.label}
        {p.href && <ExternalLink size={10} />}
      </span>
      <b className={p.small ? 'ghs-small' : ''} title={p.value}>{p.value}</b>
      <span className="dash-tile-sub">{p.sub}</span>
    </>
  )
  return p.href ? (
    <button className="dash-tile ghs-tile ghs-link" data-testid={`ghs-${p.testid}`} title={p.title ?? `Open on GitHub: ${p.href}`} onClick={() => open(p.href)}>
      {body}
    </button>
  ) : (
    <div className="dash-tile ghs-tile" data-testid={`ghs-${p.testid}`} title={p.title}>
      {body}
    </div>
  )
}
