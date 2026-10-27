import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { ExternalLink, GitCommitHorizontal, GitMerge, GitPullRequest, RefreshCw, Trash2 } from 'lucide-react'
import { parseDiff, type DiffFile } from '../lib/diff'
import { openInEditor } from '../lib/actions'
import { getMission, missionBase, refreshStats, useMission } from '../state/missions'
import { removeMissionFlow } from '../lib/removals'

const MAX_LINES = 3000

export function DiffPanel(props: IDockviewPanelProps<{ missionId: string }>): React.JSX.Element {
  const mission = useMission(props.params.missionId)
  const [files, setFiles] = useState<DiffFile[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [commitMsg, setCommitMsg] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const scroller = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const m = getMission(props.params.missionId)
    if (!m) return
    setError('')
    try {
      setFiles(parseDiff(await window.api.git.diff(m.cwd, missionBase(m))))
      void refreshStats(m.id)
    } catch (e) {
      setFiles([])
      setError(clean(e))
    }
  }, [props.params.missionId])

  useEffect(() => void load(), [load])

  const totals = useMemo(() => (files ?? []).reduce((a, f) => ({ add: a.add + f.additions, del: a.del + f.deletions }), { add: 0, del: 0 }), [files])

  if (!mission) return <div className="panel-page muted">This mission no longer exists.</div>
  const wt = mission.worktree

  const act = async (label: string, fn: () => Promise<string | void>): Promise<void> => {
    setBusy(label)
    setNotice('')
    setError('')
    try {
      const out = await fn()
      setNotice(typeof out === 'string' && out.trim() ? out.trim().split('\n').slice(-3).join('\n') : `${label}: done`)
      await load()
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="diff-panel">
      <div className="diff-toolbar">
        <div className="diff-title">
          <strong>{mission.title}</strong>
          <span className="muted">
            {wt ? `${wt.branch} ← ${wt.base}` : 'changes since mission start'} · <span className="add">+{totals.add}</span> <span className="del">−{totals.del}</span> · {files?.length ?? 0} files
          </span>
        </div>
        <span className="spacer" />
        <button className="btn sm" onClick={() => void load()} disabled={!!busy}><RefreshCw size={13} /> Refresh</button>
        <button className="btn sm" onClick={() => void openInEditor(mission.cwd, undefined, true)}><ExternalLink size={13} /> Open</button>
        <button className="btn sm" disabled={!!busy || !files?.length} onClick={() => setCommitMsg(commitMsg === null ? mission.title : null)}><GitCommitHorizontal size={13} /> Commit</button>
        {wt && (
          <>
            <button className="btn sm" disabled={!!busy} title={`git merge --no-ff ${wt.branch} into ${wt.base} (in the main checkout)`} onClick={() => void act('Merge', () => window.api.git.merge(wt.repo, wt.branch))}>
              <GitMerge size={13} /> Merge into {wt.base}
            </button>
            <button className="btn sm" disabled={!!busy} title="git push, then gh pr create" onClick={() => void act('Pull request', () => window.api.git.pushAndPr(mission.cwd, wt.branch, wt.base, mission.title))}>
              <GitPullRequest size={13} /> Push & PR
            </button>
            <button className="btn sm danger" disabled={!!busy} title="Remove the mission and its worktree…" aria-label="Remove the mission and its worktree" onClick={() => void removeMissionFlow(mission.id)}>
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
      {commitMsg !== null && (
        <form
          className="diff-commit"
          onSubmit={(e) => {
            e.preventDefault()
            const msg = commitMsg.trim()
            if (!msg) return
            setCommitMsg(null)
            void act('Commit', () => window.api.git.commitAll(mission.cwd, msg))
          }}
        >
          <input autoFocus value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="Commit message" />
          <button className="btn sm primary" type="submit">Commit all</button>
        </form>
      )}
      {busy && <div className="diff-notice">{busy}…</div>}
      {notice && <pre className="diff-notice ok">{/^https?:\/\//.test(notice) ? <a onClick={() => void window.api.shell.openExternal(notice)}>{notice}</a> : notice}</pre>}
      {error && <pre className="diff-notice err">{error}</pre>}
      <div className="diff-body">
        <div className="diff-files">
          {(files ?? []).map((f) => (
            <button key={f.path} className="diff-file-item" title={f.path} onClick={() => scroller.current?.querySelector(`[data-file="${CSS.escape(f.path)}"]`)?.scrollIntoView({ block: 'start' })}>
              <span className={`diff-status ${f.status}`}>{f.status[0].toUpperCase()}</span>
              <span className="diff-file-name">{f.path.split('/').pop()}</span>
              <span className="add">+{f.additions}</span>
              <span className="del">−{f.deletions}</span>
            </button>
          ))}
        </div>
        <div className="diff-content" ref={scroller}>
          {files === null && <div className="muted pad">Loading…</div>}
          {files?.length === 0 && !error && <div className="muted pad">No changes yet.</div>}
          {(files ?? []).map((f) => {
            const big = f.lines.length > MAX_LINES && !expanded.has(f.path)
            return (
              <section key={f.path} data-file={f.path} className="diff-section">
                <header className="diff-file-head">
                  <span className={`diff-status ${f.status}`}>{f.status}</span>
                  <span className="mono">{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</span>
                  <span className="spacer" />
                  <button className="icon-btn" title="Open file" onClick={() => void openInEditor(`${mission.cwd}/${f.path}`)}>
                    <ExternalLink size={12} />
                  </button>
                </header>
                {f.binary ? (
                  <div className="muted pad">Binary file</div>
                ) : big ? (
                  <button className="btn sm big-diff" onClick={() => setExpanded((s) => new Set(s).add(f.path))}>
                    Show {f.lines.length} lines
                  </button>
                ) : (
                  <table className="diff-table">
                    <tbody>
                      {f.lines.map((l, i) => (
                        <tr key={i} className={l.kind}>
                          <td className="ln">{l.oldNo ?? ''}</td>
                          <td className="ln">{l.newNo ?? ''}</td>
                          <td className="code">{l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : l.kind === 'ctx' ? ' ' : ''}{l.text}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function clean(e: unknown): string {
  return String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')
}
