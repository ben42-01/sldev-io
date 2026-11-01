import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { ChevronDown, ChevronRight, Columns2, ExternalLink, FileDiff, GitCommitHorizontal, GitMerge, GitPullRequest, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, RefreshCw, Rows2, Trash2 } from 'lucide-react'
import { parseDiff, splitRows, type DiffFile, type DiffLine } from '../lib/diff'
import { openFileAt, openInEditor } from '../lib/actions'
import { getMission, missionBase, refreshStats, useMission } from '../state/missions'
import { removeMissionFlow } from '../lib/removals'
import { preferredEditor, updateSettings, workspace } from '../state/workspace'
import { reviewFocus } from '../state/focus'
import { useStore } from '../state/store'
import { Empty, Loading } from '../components/States'

const MAX_LINES = 3000

export function DiffPanel(props: IDockviewPanelProps<{ missionId: string }>): React.JSX.Element {
  const mission = useMission(props.params.missionId)
  const [files, setFiles] = useState<DiffFile[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [commitMsg, setCommitMsg] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  /** files the reviewer ticked as seen; kept for this tab only */
  const [viewed, setViewed] = useState<Set<string>>(new Set())
  const [showFiles, setShowFiles] = useState(true)
  const layout = useStore(workspace, (w) => w.diffLayout ?? 'split')
  const focusOn = useStore(workspace, (w) => w.reviewFocus !== false)
  const [visible, setVisible] = useState(props.api.isVisible)
  const scroller = useRef<HTMLDivElement>(null)
  const editor = preferredEditor()

  useEffect(() => {
    const d = props.api.onDidVisibilityChange((e) => setVisible(e.isVisible))
    return () => d.dispose()
  }, [props.api])

  // the sidebars step aside only while this tab is on screen
  useEffect(() => {
    const id = props.api.id
    const dock = props.containerApi
    const on = focusOn && visible
    /** only a maximize this tab did is undone; one the user chose stays */
    let maximized = false
    if (on) {
      reviewFocus.set({ panel: id })
      // other splits (terminals next to it) step aside too
      const panel = dock.getPanel(id)
      if (panel && dock.groups.length > 1 && !dock.hasMaximizedGroup()) {
        dock.maximizeGroup(panel)
        maximized = true
      }
    }
    return () => {
      if (!on) return
      if (reviewFocus.get().panel === id) reviewFocus.set({ panel: null })
      if (maximized && dock.hasMaximizedGroup()) dock.exitMaximizedGroup()
    }
  }, [focusOn, visible, props.api.id, props.containerApi])

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
  const base = missionBase(mission)

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

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, path: string): void =>
    set((s) => {
      const n = new Set(s)
      if (n.has(path)) n.delete(path)
      else n.add(path)
      return n
    })
  const markViewed = (path: string): void => {
    toggle(setViewed, path)
    // a file marked as seen folds away, like on GitHub
    setCollapsed((s) => (viewed.has(path) ? (s.delete(path), new Set(s)) : new Set(s).add(path)))
  }
  const jump = (path: string): void => {
    setCollapsed((s) => (s.has(path) ? (s.delete(path), new Set(s)) : s))
    requestAnimationFrame(() => scroller.current?.querySelector(`[data-file="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'start' }))
  }
  const editorDiff = (f: DiffFile): void => {
    if (!editor?.canDiff) return void openFileAt(`${mission.cwd}/${f.path}`)
    void window.api.editors.diff(editor.id, mission.cwd, base, f.path, f.oldPath)
  }

  return (
    <div className="diff-panel">
      <div className="diff-toolbar">
        <button
          className="icon-btn"
          title={showFiles ? 'Hide the file list' : 'Show the file list'}
          aria-label={showFiles ? 'Hide the file list' : 'Show the file list'}
          onClick={() => setShowFiles((v) => !v)}
        >
          {showFiles ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
        </button>
        <div className="diff-title">
          <strong title={mission.title}>{mission.title}</strong>
          <span className="muted">
            {wt ? `${wt.branch} ← ${wt.base}` : 'changes since mission start'} · <span className="add">+{totals.add}</span> <span className="del">−{totals.del}</span> · {files?.length ?? 0} file{files?.length === 1 ? '' : 's'}
            {files && files.length > 0 ? ` · ${viewed.size}/${files.length} viewed` : ''}
          </span>
        </div>
        <span className="spacer" />
        <div className="seg sm" role="group" aria-label="Diff layout">
          <button type="button" className={layout === 'split' ? 'on' : ''} aria-pressed={layout === 'split'} title="Side by side" onClick={() => updateSettings({ diffLayout: 'split' })}>
            <Columns2 size={13} /> Split
          </button>
          <button type="button" className={layout === 'unified' ? 'on' : ''} aria-pressed={layout === 'unified'} title="One column" onClick={() => updateSettings({ diffLayout: 'unified' })}>
            <Rows2 size={13} /> Unified
          </button>
        </div>
        <button
          className={`icon-btn${focusOn ? ' on' : ''}`}
          title={focusOn ? 'Focus is on: the sidebars hide while you review. Click to keep them.' : 'Focus: hide the sidebars while you review'}
          aria-label={focusOn ? 'Show the sidebars while reviewing' : 'Hide the sidebars while reviewing'}
          aria-pressed={focusOn}
          onClick={() => updateSettings({ reviewFocus: !focusOn })}
        >
          {focusOn ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button className="icon-btn" title="Refresh" aria-label="Refresh" disabled={!!busy} onClick={() => void load()}>
          <RefreshCw size={14} />
        </button>
        <button className="btn sm" title={`Open the ${wt ? 'worktree' : 'folder'} in ${editor?.name ?? 'your file manager'}`} onClick={() => void openInEditor(mission.cwd, undefined, true)}>
          <ExternalLink size={13} /> Open in {editor?.name ?? 'folder'}
        </button>
        <button className="btn sm" disabled={!!busy || !files?.length} onClick={() => setCommitMsg(commitMsg === null ? mission.title : null)}>
          <GitCommitHorizontal size={13} /> Commit
        </button>
        {wt && (
          <>
            <button className="btn sm" disabled={!!busy} title={`git merge --no-ff ${wt.branch} into ${wt.base} (in the main checkout)`} onClick={() => void act('Merge', () => window.api.git.merge(wt.repo, wt.branch))}>
              <GitMerge size={13} /> Merge into {wt.base}
            </button>
            <button className="btn sm" disabled={!!busy} title="git push, then gh pr create" onClick={() => void act('Pull request', () => window.api.git.pushAndPr(mission.cwd, wt.branch, wt.base, mission.title))}>
              <GitPullRequest size={13} /> Push & PR
            </button>
            <button className="icon-btn danger" disabled={!!busy} title="Remove the mission and its worktree…" aria-label="Remove the mission and its worktree" onClick={() => void removeMissionFlow(mission.id)}>
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
      {mission.criteria && (
        <details className="diff-criteria">
          <summary>Acceptance criteria</summary>
          <pre className="selectable">{mission.criteria}</pre>
        </details>
      )}
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
          <input autoFocus value={commitMsg} aria-label="Commit message" onChange={(e) => setCommitMsg(e.target.value)} placeholder="Commit message" />
          <button className="btn sm primary" type="submit">Commit all</button>
          <button className="btn sm ghost" type="button" onClick={() => setCommitMsg(null)}>Cancel</button>
        </form>
      )}
      {busy && <div className="diff-notice">{busy}…</div>}
      {notice && <pre className="diff-notice ok">{/^https?:\/\//.test(notice) ? <a onClick={() => void window.api.shell.openExternal(notice)}>{notice}</a> : notice}</pre>}
      {error && <pre className="diff-notice err">{error}</pre>}
      <div className="diff-body">
        {showFiles && files && files.length > 0 && (
          <nav className="diff-files" aria-label="Changed files">
            {files.map((f) => {
              const slash = f.path.lastIndexOf('/')
              return (
                <button key={f.path} className={`diff-file-item${viewed.has(f.path) ? ' viewed' : ''}`} title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path} onClick={() => jump(f.path)}>
                  <span className={`diff-status ${f.status}`}>{f.status[0].toUpperCase()}</span>
                  <span className="diff-file-name">
                    {f.path.slice(slash + 1)}
                    {slash > 0 && <span className="diff-file-dir">{f.path.slice(0, slash)}</span>}
                  </span>
                  <span className="add">+{f.additions}</span>
                  <span className="del">−{f.deletions}</span>
                </button>
              )
            })}
          </nav>
        )}
        <div className="diff-content" ref={scroller}>
          {files === null && <Loading what="Reading the diff…" />}
          {files?.length === 0 && !error && <Empty icon={<FileDiff size={20} />} title="No changes yet" hint="When the agent edits files, they show up here. Refresh after it finishes a turn." />}
          {(files ?? []).map((f) => {
            const big = f.lines.length > MAX_LINES && !expanded.has(f.path)
            const closed = collapsed.has(f.path)
            return (
              <section key={f.path} data-file={f.path} className="diff-section">
                <header className="diff-file-head">
                  <button className="icon-btn" title={closed ? 'Expand' : 'Collapse'} aria-label={closed ? 'Expand file' : 'Collapse file'} aria-expanded={!closed} onClick={() => toggle(setCollapsed, f.path)}>
                    {closed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  </button>
                  <span className={`diff-status ${f.status}`}>{f.status}</span>
                  <span className="mono diff-file-path" title={f.path}>{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</span>
                  <span className="add">+{f.additions}</span>
                  <span className="del">−{f.deletions}</span>
                  <span className="spacer" />
                  <label className="check diff-viewed">
                    <input type="checkbox" checked={viewed.has(f.path)} onChange={() => markViewed(f.path)} />
                    <span>Viewed</span>
                  </label>
                  {f.status !== 'deleted' && (
                    <>
                      {editor?.canDiff && !f.binary && (
                        <button className="btn sm ghost" title={`Open this file's diff in ${editor.name}`} onClick={() => editorDiff(f)}>
                          <FileDiff size={12} /> Diff in {editor.name}
                        </button>
                      )}
                      <button className="icon-btn" title={`Open the file${editor ? ` in ${editor.name}` : ''}`} aria-label="Open the file" onClick={() => void openFileAt(`${mission.cwd}/${f.path}`, firstChange(f))}>
                        <ExternalLink size={13} />
                      </button>
                    </>
                  )}
                </header>
                {closed ? null : f.binary ? (
                  <div className="muted pad">Binary file</div>
                ) : big ? (
                  <button className="btn sm big-diff" onClick={() => setExpanded((s) => new Set(s).add(f.path))}>
                    Show {f.lines.length} lines
                  </button>
                ) : layout === 'split' ? (
                  <SplitTable file={f} open={(n) => void openFileAt(`${mission.cwd}/${f.path}`, n)} />
                ) : (
                  <table className="diff-table">
                    <tbody>
                      {f.lines.map((l, i) => (
                        <tr key={i} className={l.kind}>
                          <td className="ln">{l.oldNo ?? ''}</td>
                          <td className="ln" onDoubleClick={() => l.newNo && void openFileAt(`${mission.cwd}/${f.path}`, l.newNo)}>{l.newNo ?? ''}</td>
                          <td className="sign">{sign(l)}</td>
                          <td className="code">{l.text}</td>
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

function SplitTable({ file, open }: { file: DiffFile; open: (line: number) => void }): React.JSX.Element {
  const rows = useMemo(() => splitRows(file.lines), [file])
  return (
    <table className="diff-table split">
      <colgroup>
        <col className="ln-col" />
        <col className="sign-col" />
        <col />
        <col className="ln-col" />
        <col className="sign-col" />
        <col />
      </colgroup>
      <tbody>
        {rows.map((r, i) =>
          r.kind === 'pair' ? (
            <tr key={i}>
              <Side line={r.left} no={r.left?.oldNo} />
              <Side line={r.right} no={r.right?.newNo} open={open} />
            </tr>
          ) : (
            <tr key={i} className={r.kind}>
              <td colSpan={6} className="code">{r.text}</td>
            </tr>
          )
        )}
      </tbody>
    </table>
  )
}

function Side({ line, no, open }: { line?: DiffLine; no?: number; open?: (line: number) => void }): React.JSX.Element {
  const kind = line?.kind ?? 'blank'
  return (
    <Fragment>
      <td className={`ln ${kind}`} onDoubleClick={() => no && open?.(no)}>{no ?? ''}</td>
      <td className={`sign ${kind}`}>{line ? sign(line) : ''}</td>
      <td className={`code ${kind}`}>{line?.text ?? ''}</td>
    </Fragment>
  )
}

const sign = (l: DiffLine): string => (l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : '')

/** where the first change is, so "open file" lands on it */
const firstChange = (f: DiffFile): number | undefined => f.lines.find((l) => l.kind === 'add' || l.kind === 'del')?.newNo ?? f.lines.find((l) => l.newNo)?.newNo

function clean(e: unknown): string {
  return String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')
}
