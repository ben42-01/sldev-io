import { useState } from 'react'
import { CircleDot } from 'lucide-react'
import type { GhIssue } from '@shared/types'

/** "From issue": lists the repo's open GitHub issues (through gh) and hands back the one picked. */
export function IssuePicker({ root, onPick }: { root: string; onPick: (issue: GhIssue) => void }): React.JSX.Element {
  const [issues, setIssues] = useState<GhIssue[] | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const load = (): void => {
    setOpen(true)
    setError('')
    window.api.gh.issues(root).then(setIssues, (e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').split('\n')[0]))
  }
  if (!open)
    return (
      <button type="button" className="btn sm issue-btn" onClick={load}>
        <CircleDot size={12} /> From a GitHub issue
      </button>
    )
  return (
    <div className="issue-picker">
      {error && <div className="bad">{error}</div>}
      {!error && !issues && <div className="hint">Loading issues…</div>}
      {issues && !issues.length && <div className="hint">No open issues.</div>}
      {issues?.map((i) => (
        <button type="button" key={i.number} className="issue-row" title={i.url} onClick={() => (onPick(i), setOpen(false))}>
          <span className="issue-n">#{i.number}</span>
          <span className="issue-title">{i.title}</span>
        </button>
      ))}
      <button type="button" className="link issue-close" onClick={() => setOpen(false)}>Close</button>
    </div>
  )
}
