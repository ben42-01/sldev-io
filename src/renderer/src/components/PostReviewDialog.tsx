import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { DiffFile } from '@shared/diff'
import type { DraftComment } from '@shared/review'
import { EVENT_LABEL, type ReviewEvent } from '@shared/ship'
import { closePostReview, draftReview, postingReview, postReview } from '../state/review'
import type { ReviewSource } from '../state/reviewTargets'
import { useStore } from '../state/store'
import { Modal } from './Modal'
import { Loading } from './States'
import { toast } from './Toast'

/**
 * Post review: the notes written on the cockpit's parts as comments on their first changed line (each editable or
 * left out), plus a summary that also carries the notes whose lines changed since. One review on GitHub, on the
 * reviewed commit, only on the click.
 */
export function PostReviewHost({ source, files }: { source: ReviewSource; files: DiffFile[] | null }): React.JSX.Element | null {
  const open = useStore(postingReview, (s) => (s.key === source.key ? s.event : null))
  if (!open || !source.pr) return null
  return <PostReviewDialog key={`${source.key}-${open}`} source={source} files={files ?? []} first={open} />
}

function PostReviewDialog({ source, files, first }: { source: ReviewSource; files: DiffFile[]; first: ReviewEvent }): React.JSX.Element {
  const [event, setEvent] = useState<ReviewEvent>(first)
  const [comments, setComments] = useState<Array<DraftComment & { on: boolean }> | null>(null)
  const [loose, setLoose] = useState<string[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    void draftReview(source.target, files)
      .then((d) => {
        if (!live) return
        setComments(d.comments.map((c) => ({ ...c, on: true })))
        setLoose(d.summary)
      })
      .catch((e) => live && setError(String(e)))
    return () => {
      live = false
    }
    // the notes as they are when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const kept = (comments ?? []).filter((c) => c.on && c.body.trim())
  const post = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      toast(await postReview(source.target, event, text, loose, kept))
      closePostReview()
    } catch (e) {
      setError(String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  const n = source.pr!.number

  return (
    <Modal
      title={`Review #${n}`}
      size="lg"
      busy={busy}
      onClose={closePostReview}
      onSubmit={() => void post()}
      footerNote={`Posted on GitHub as you, on ${source.head ? source.head.slice(0, 7) : 'the PR'}. Nothing is posted until you click.`}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={closePostReview} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || comments === null}>
            {EVENT_LABEL[event]}{kept.length ? ` with ${kept.length} comment${kept.length === 1 ? '' : 's'}` : ''}
          </button>
        </>
      }
    >
      <div className="form post-review">
        <div className="seg sm" role="group" aria-label="Review type">
          {(['COMMENT', 'REQUEST_CHANGES', 'APPROVE'] as ReviewEvent[]).map((e) => (
            <button key={e} type="button" className={event === e ? 'on' : ''} aria-pressed={event === e} onClick={() => setEvent(e)}>
              {EVENT_LABEL[e]}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Summary</span>
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={event === 'REQUEST_CHANGES' ? 'What should change, overall' : 'Optional'} />
          {loose.length > 0 && (
            <span className="field-hint">
              Added below it: {loose.length === 1 ? 'a note' : `${loose.length} notes`} whose lines changed since you wrote {loose.length === 1 ? 'it' : 'them'}.
            </span>
          )}
        </label>
        {loose.length > 0 && (
          <ul className="post-review-loose">
            {loose.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
        <div className="field">
          <span>Comments on lines</span>
          {comments === null ? (
            <Loading what="Reading your notes…" />
          ) : comments.length === 0 ? (
            <span className="field-hint">No notes on parts. Write one with Send back… (S) on a part, and it lands on that part's first changed line.</span>
          ) : (
            <ul className="post-review-comments">
              {comments.map((c, i) => (
                <li key={c.part} className={c.on ? '' : 'off'}>
                  <div className="post-review-at">
                    <span className="mono" title={c.side === 'LEFT' ? 'A removed line' : 'A line of the PR'}>
                      {c.path}:{c.line}
                      {c.side === 'LEFT' ? ' (removed)' : ''}
                    </span>
                    <span className="muted">{c.title}</span>
                    <span className="spacer" />
                    <button
                      type="button"
                      className="icon-btn"
                      title={c.on ? 'Leave this one out' : 'Put it back'}
                      aria-label={c.on ? `Leave out the comment on ${c.path}` : `Put back the comment on ${c.path}`}
                      onClick={() => setComments((l) => l!.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
                    >
                      <X size={12} />
                    </button>
                  </div>
                  {c.on && <textarea rows={2} aria-label={`Comment on ${c.path}:${c.line}`} value={c.body} onChange={(e) => setComments((l) => l!.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />}
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
      </div>
    </Modal>
  )
}
