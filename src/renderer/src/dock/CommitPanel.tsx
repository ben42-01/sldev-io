import { useCallback, useEffect, useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { Columns2, Copy, FileDiff, RefreshCw, Rows2 } from 'lucide-react'
import { parseDiff, type DiffFile } from '../lib/diff'
import { DiffLines } from '../components/DiffTables'
import { openFileAt } from '../lib/actions'
import { updateSettings, workspace } from '../state/workspace'
import { useStore } from '../state/store'
import { Empty, ErrorBanner, Loading } from '../components/States'
import { toast } from '../components/Toast'

const MAX_LINES = 3000

/** One commit's own changes (a merge against its first parent), opened from the commit graph. Read-only. */
export function CommitPanel(props: IDockviewPanelProps<{ cwd: string; sha: string; subject?: string }>): React.JSX.Element {
  const { cwd, sha, subject } = props.params
  const [files, setFiles] = useState<DiffFile[] | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const layout = useStore(workspace, (w) => w.diffLayout ?? 'split')

  const load = useCallback(async () => {
    setError('')
    setFiles(null)
    try {
      setFiles(parseDiff(await window.api.git.showCommit(cwd, sha)))
    } catch (e) {
      setFiles([])
      setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
    }
  }, [cwd, sha])

  useEffect(() => void load(), [load])

  const totals = useMemo(() => (files ?? []).reduce((a, f) => ({ add: a.add + f.additions, del: a.del + f.deletions }), { add: 0, del: 0 }), [files])

  return (
    <div className="diff-panel commit-panel" data-testid="commit-panel">
      <div className="diff-toolbar">
        <button className="cg-sha mono" title={`Copy ${sha}`} aria-label="Copy the commit hash" onClick={() => void navigator.clipboard.writeText(sha).then(() => toast(`Copied ${sha.slice(0, 7)}`))}>
          {sha.slice(0, 7)}
          <Copy size={10} />
        </button>
        <span className="commit-panel-subject" title={subject}>{subject}</span>
        {files && (
          <span className="muted small">
            {files.length} file{files.length === 1 ? '' : 's'} <span className="add">+{totals.add}</span> <span className="del">−{totals.del}</span>
          </span>
        )}
        <span className="spacer" />
        <div className="seg sm" role="group" aria-label="Layout">
          <button className={layout === 'split' ? 'on' : ''} title="Side by side" onClick={() => updateSettings({ diffLayout: 'split' })}>
            <Columns2 size={12} />
          </button>
          <button className={layout === 'unified' ? 'on' : ''} title="Unified" onClick={() => updateSettings({ diffLayout: 'unified' })}>
            <Rows2 size={12} />
          </button>
        </div>
        <button className="icon-btn" title="Refresh" aria-label="Refresh" onClick={() => void load()}>
          <RefreshCw size={13} />
        </button>
      </div>
      {error && <ErrorBanner onRetry={() => void load()}>Couldn't read the commit: {error}</ErrorBanner>}
      <div className="diff-content">
        {files === null && <Loading what="Reading the commit…" />}
        {files?.length === 0 && !error && <Empty icon={<FileDiff size={20} />} title="No file changes" hint="This commit changes no files (an empty commit, or a merge that took its first parent as is)." />}
        {(files ?? []).map((f) => {
          const big = f.lines.length > MAX_LINES && !expanded.has(f.path)
          return (
            <section key={f.path} className="diff-section">
              <header className="diff-file-head">
                <span className={`diff-status ${f.status}`}>{f.status}</span>
                <span className="mono diff-file-path" title={f.path}>{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</span>
                <span className="add">+{f.additions}</span>
                <span className="del">−{f.deletions}</span>
              </header>
              {f.binary ? (
                <div className="muted pad">Binary file</div>
              ) : big ? (
                <button className="btn sm big-diff" onClick={() => setExpanded((s) => new Set(s).add(f.path))}>
                  Show {f.lines.length} lines
                </button>
              ) : (
                <DiffLines lines={f.lines} layout={layout} open={f.status === 'deleted' ? undefined : (n) => void openFileAt(`${cwd}/${f.path}`, n)} />
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
