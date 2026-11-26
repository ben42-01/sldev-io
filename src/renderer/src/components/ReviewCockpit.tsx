import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, ArrowLeft, ArrowRight, Bot, Check, ChevronDown, CircleHelp, CircleX, Circle, Clock, ExternalLink, FileText, GitCommitHorizontal, History, Lightbulb, ListChecks, LoaderCircle, MapPin, MessageCircleQuestion, Network, RotateCcw, Scissors, ShieldAlert, Sparkles, Undo2, Wand2 } from 'lucide-react'
import { blastRadius, buildCockpit, carryMarks, changedNames, CUT_NOTE, fileOrder, formatMinutes, hunksOf, LINES_PER_MINUTE, movedText, partMinutes, reviewMinutes, reviewOrder, sinceReview, type Cockpit, type Hunk, type Need, type Part, type Radius, type Use, type Walkthrough } from '@shared/review'
import type { DiffFile } from '@shared/diff'
import { allAgents } from '../lib/agents'
import { openFileAt } from '../lib/actions'
import { scrollToTop } from '../lib/scroll'
import { getAgent } from '../state/agents'
import { focusOrResume, isLive } from '../state/missions'
import { askAboutPart, diffSignature, explainChanges, markPart, readWalkthrough, sendBack, settleReview } from '../state/review'
import { firstAgent, reviewHead, workingOn, type ReviewHead, type ReviewSource } from '../state/reviewTargets'
import { updateSettings, workspace } from '../state/workspace'
import { useStore } from '../state/store'
import { showContextMenu } from './ContextMenu'
import { DiffLines } from './DiffTables'
import { ReviewListResizer, reviewListWidth } from './PaneResizer'
import { ReviewChecks } from './ReviewChecks'
import { Empty } from './States'
import { toast } from './Toast'

const NEED: Record<Need, { label: string; hint: string }> = {
  asked: { label: 'Asked for', hint: 'The task or a criterion needs it' },
  supports: { label: 'Supports it', hint: 'What the asked part needs to work' },
  extra: { label: 'Not asked for', hint: 'Nobody asked for this: a refactor, an option or something for later' },
  unknown: { label: 'Not explained', hint: 'No agent has said why this is here' }
}

const NOISE_ID = '__noise'

/**
 * The review cockpit: the diff in reading order, by what each part is for. Works on its own (parts by
 * folder, noise folded, risky spots flagged); with a walkthrough, an agent has said why each part is there,
 * whether it was asked for and if there is a simpler way. Each part gets a verdict, and what was sent back
 * goes to the agent that did the work as one follow-up.
 */
export function ReviewCockpit({ source, files, layout }: { source: ReviewSource; files: DiffFile[]; layout: 'split' | 'unified' }): React.JSX.Element {
  const review = source.review
  const target = source.target
  const walkState = review?.walk
  const [walk, setWalk] = useState<Walkthrough | null>(null)
  /** the part on screen, by id (NOISE_ID for the noise), so switching the order keeps it */
  const [sel, setSel] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ part: string; note: string } | null>(null)
  const [asking, setAsking] = useState<{ part: string; q: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** "Since last review": only the hunks that changed since the last verdict */
  const [since, setSince] = useState(false)
  const [head, setHead] = useState<ReviewHead>({})
  const root = useRef<HTMLDivElement>(null)
  const main = useRef<HTMLDivElement>(null)
  const listWidth = useStore(workspace, (w) => reviewListWidth(w.reviewListWidth))
  const order = useStore(workspace, (w) => w.reviewOrder ?? 'review')

  useEffect(() => void settleReview(target), [target])
  useEffect(() => {
    let live = true
    void readWalkthrough(target).then((w) => live && setWalk(w))
    return () => {
      live = false
    }
  }, [target, walkState?.status, walkState?.file])

  const seenHead = review?.seen?.head
  // the commit the change is at, read again with every new diff
  useEffect(() => {
    let live = true
    void reviewHead(target, seenHead).then((h) => live && setHead(h))
    return () => {
      live = false
    }
  }, [target, files, seenHead])

  const criteria = source.criteria
  const c: Cockpit = useMemo(() => buildCockpit(files, walk, criteria), [files, walk, criteria])
  // blast radius: where the names this change touched are used, found once per version of the diff
  const sig = useMemo(() => diffSignature(files), [files])
  const real = useMemo(() => hunksOf(files).filter((h) => !h.noise), [files])
  const changed = useMemo(() => changedNames(real), [real])
  const [usesFound, setUsesFound] = useState<{ sig: string; uses: Use[]; capped: boolean } | null>(null)
  useEffect(() => {
    if (!changed.length) return
    let live = true
    void window.api.git
      .uses(source.cwd, changed.map((n) => n.name))
      .then((r) => live && setUsesFound({ sig, ...r }))
      .catch(() => live && setUsesFound({ sig, uses: [], capped: false }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.cwd, sig])
  const radius = useMemo(() => (usesFound && changed.length ? blastRadius(changed, real, usesFound.uses).filter((x) => x.uses > 0) : []), [usesFound, changed, real])
  const stale = !!walk && !!walkState?.diff && walkState.diff !== diffSignature(files)
  const all = useMemo(() => [...c.parts.flatMap((p) => p.hunks), ...c.noise], [c])
  // marks hold only while their part's hunks are the ones they were made on
  const carry = useMemo(() => carryMarks(c.parts, review?.marks), [c, review?.marks])
  const delta = useMemo(() => sinceReview(c, review?.seen), [c, review?.seen])
  const moved = !!delta && (delta.fresh > 0 || delta.gone > 0)
  const onlyNew = since && moved && !!delta
  const ranked = useMemo(() => reviewOrder(c), [c])
  const ordered = useMemo(() => (order === 'file' ? fileOrder(c) : ranked), [order, c, ranked])
  // "Since last review": the same order, each part with only its new hunks
  const parts = useMemo(() => {
    if (!onlyNew || !delta) return ordered
    const fresh = new Map(delta.parts.map((p) => [p.id, p]))
    return ordered.flatMap((p) => fresh.get(p.id) ?? [])
  }, [ordered, onlyNew, delta])
  const noise = onlyNew && delta ? delta.noise : c.noise
  const fullOf = (p: Part): Part => c.parts.find((x) => x.id === p.id) ?? p
  const startHere = (onlyNew ? parts : ranked)[0]?.id
  const found = sel === NOISE_ID ? parts.length : parts.findIndex((p) => p.id === sel)
  // nothing picked yet (or the part is gone): open where the review starts
  const index = found >= 0 ? found : Math.max(0, parts.findIndex((p) => p.id === startHere))
  const current: Part | undefined = parts[index]
  const marks = carry.marks
  const time = reviewMinutes(c, (p) => !!marks[p.id])
  const back = c.parts.filter((p) => marks[p.id]?.note)
  const seen = c.parts.filter((p) => marks[p.id]).reduce((a, p) => a + p.lines, 0)
  const changedParts = delta ? delta.parts.length : 0
  // caught up: the next change opens on the whole diff again
  useEffect(() => {
    if (!moved) setSince(false)
  }, [moved])
  const writing = walkState?.status === 'writing'
  const agentName = getAgent(source.agent).name

  const go = (i: number): void => {
    const j = Math.max(0, Math.min(noise.length ? parts.length : parts.length - 1, i))
    setSel(j === parts.length ? NOISE_ID : (parts[j]?.id ?? null))
    setEditing(null)
    setAsking(null)
    requestAnimationFrame(() => scrollToTop(main.current))
  }
  const next = (): void => {
    // after a verdict, on to the next part nobody has looked at yet
    const after = parts.findIndex((p, i) => i > index && !marks[p.id])
    go(after >= 0 ? after : Math.min(parts.length, index + 1))
  }
  const ok = (p: Part): void => {
    markPart(target, fullOf(p), marks[p.id]?.ok ? null : { ok: true }, all, head.head)
    if (!marks[p.id]?.ok) next()
  }
  const saveNote = (): void => {
    if (!editing) return
    const p = c.parts.find((x) => x.id === editing.part)
    if (p) markPart(target, p, editing.note.trim() ? { note: editing.note.trim() } : null, all, head.head)
    setEditing(null)
    if (editing.note.trim()) next()
  }

  const explain = async (agentId: string): Promise<void> => {
    setError('')
    try {
      await explainChanges(target, agentId)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const explainMenu = (e: React.MouseEvent): void =>
    showContextMenu(e, [
      { type: 'header', label: 'Explain with' },
      ...allAgents(workspace.get().customAgents)
        .filter((a) => a.canPrint)
        .map((a) => ({ label: a.id === source.agent ? `${a.name} (did the work)` : a.name, icon: <Bot size={13} />, run: () => void explain(a.id) }))
    ])
  const ask = async (): Promise<void> => {
    if (!asking || !current || !asking.q.trim()) return
    const q = asking.q
    setAsking(null)
    setError('')
    try {
      await askAboutPart(target, current, q, firstAgent(source))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const send = async (): Promise<void> => {
    setBusy(true)
    try {
      const m = await sendBack(target, back.map((p) => ({ part: p, note: marks[p.id]!.note! })))
      if (m) toast(`Sent ${back.length === 1 ? 'one part' : `${back.length} parts`} back to ${getAgent(m.options.agent).name}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if ((e.target as HTMLElement).closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 'j' || e.key === 'ArrowDown') go(index + 1)
    else if (k === 'k' || e.key === 'ArrowUp') go(index - 1)
    else if (k === 'a' && current) ok(current)
    else if (k === 's' && current) setEditing({ part: current.id, note: marks[current.id]?.note ?? '' })
    else if (k === 'q' && current) setAsking({ part: current.id, q: '' })
    else return
    e.preventDefault()
  }

  if (!files.length) return <Empty icon={<ListChecks size={20} />} title="No changes yet" hint="When the agent edits files, the walkthrough of its change shows up here." />

  const t = c.totals
  const shown = t.lines + t.noise || 1
  return (
    <div className="rc" ref={root} tabIndex={-1} onKeyDown={onKey}>
      <header className="rc-head">
        <section className="rc-ask">
          <div className="field-label">The ask</div>
          <p className="rc-ask-text selectable">{source.ask.trim().split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').slice(0, 220)}</p>
          {c.criteria.length > 0 && (
            <ul className="rc-criteria">
              {c.criteria.map((k) => (
                <li key={k.n} className={k.met === true ? 'met' : k.met === false ? 'unmet' : ''} title={k.note}>
                  {k.met === true ? <Check size={12} /> : k.met === false ? <CircleX size={12} /> : <Circle size={12} />}
                  <span>{k.text}</span>
                  {k.parts.map((id) => (
                    <button key={id} className="rc-part-link" onClick={() => go(parts.findIndex((p) => p.id === id))}>
                      part {parts.findIndex((p) => p.id === id) + 1}
                    </button>
                  ))}
                  {walk && !k.parts.length && k.met !== true && <span className="rc-uncovered">no part meets this</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rc-verdict">
          {writing ? (
            <div className="rc-writing">
              <LoaderCircle size={14} className="spin" /> {getAgent(walkState.agent).name} is reading the change and writing the walkthrough…
              {walkState.mission && isLive(walkState.mission ? 'working' : 'ended') && (
                <button className="btn sm ghost" onClick={() => focusOrResume(walkState.mission)}>
                  Watch
                </button>
              )}
            </div>
          ) : walk ? (
            <>
              <div className="field-label">
                <Sparkles size={11} /> Walkthrough by {getAgent(walkState!.agent).name}
              </div>
              {c.summary && <p className="rc-summary selectable">{c.summary}</p>}
              {stale && (
                <div className="rc-stale">
                  The change moved on since this was written.
                  <button className="btn sm" onClick={explainMenu}>
                    <RotateCcw size={12} /> Explain again
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="rc-explain">
              <p>
                {walkState?.status === 'failed' ? <span className="rc-failed">{walkState.note}. </span> : null}
                Grouped by folder for now. An agent can explain each part: why it is there, whether it was asked for, and a simpler way if there is one.
              </p>
              <div className="rc-explain-actions">
                <button className="btn primary sm" onClick={() => void explain(firstAgent(source))}>
                  <Wand2 size={13} /> Explain the change
                </button>
                <button className="btn sm" title="Pick the agent that explains it" aria-label="Pick the agent that explains it" onClick={explainMenu}>
                  {agentName} <ChevronDown size={12} />
                </button>
              </div>
            </div>
          )}
          {error && <div className="rc-error">{error}</div>}
        </section>
        <section className="rc-scope" aria-label="How the change splits up">
          <div className="rc-bar">
            {(['asked', 'supports', 'extra', 'unknown'] as Need[]).map((n) => (t[n] ? <span key={n} className={`rc-bar-seg ${n}`} style={{ flexGrow: t[n] }} title={`${NEED[n].label}: ${t[n]} lines`} /> : null))}
            {t.noise > 0 && <span className="rc-bar-seg noise" style={{ flexGrow: t.noise }} title={`Noise: ${t.noise} lines`} />}
          </div>
          <div className="rc-legend">
            <span>
              <strong>{t.lines.toLocaleString()}</strong> lines to read
            </span>
            <span className="rc-time" title={`At about ${LINES_PER_MINUTE} lines a minute, plus a second look for each flagged spot; noise isn't counted`}>
              <Clock size={11} /> <strong>{formatMinutes(time.total)}</strong>
              {time.left < time.total && time.left > 0 ? ` · ${formatMinutes(time.left).replace(/^about /, '')} left` : ''}
            </span>
            {(['asked', 'supports', 'extra'] as Need[]).map((n) =>
              t[n] ? (
                <span key={n} className={`rc-key ${n}`}>
                  {t[n].toLocaleString()} {NEED[n].label.toLowerCase()}
                </span>
              ) : null
            )}
            {t.unknown > 0 && <span className="rc-key unknown">{t.unknown.toLocaleString()} not explained</span>}
            {t.noise > 0 && (
              <span className="rc-key noise">
                {t.noise.toLocaleString()} noise folded ({Math.round((t.noise / shown) * 100)}%)
              </span>
            )}
          </div>
        </section>
      </header>
      <ReviewChecks source={source} diff={sig} />

      {moved && delta && (
        <div className="rc-since" role="status">
          <GitCommitHorizontal size={14} />
          <span className="rc-since-text">
            <strong>{movedText(seenHead, head.head, head.commits)}</strong>
            {changedParts > 0 && ` · ${changedParts === 1 ? '1 part' : `${changedParts} parts`} changed`}
            {delta.fresh > 0 && ` · ${delta.fresh === 1 ? '1 hunk' : `${delta.fresh} hunks`} to read`}
            {delta.fresh === 0 && delta.gone > 0 && ` · ${delta.gone === 1 ? '1 hunk' : `${delta.gone} hunks`} you saw ${delta.gone === 1 ? 'is' : 'are'} gone`}
          </span>
          <span className="spacer" />
          <button
            className="btn sm"
            aria-pressed={onlyNew}
            title={onlyNew ? 'Show the whole change again' : 'Show only what changed since your last verdict'}
            onClick={() => {
              setSince(!onlyNew)
              setSel(null)
            }}
          >
            <History size={13} /> Since last review
          </button>
        </div>
      )}

      <div className="rc-body">
        <nav className="rc-parts" aria-label={order === 'file' ? 'Parts in file order' : 'Parts in review order'} style={{ width: listWidth }}>
          {parts.length > 1 && (
            <div className="seg sm rc-order" role="group" aria-label="Order of the parts">
              <button type="button" className={order === 'review' ? 'on' : ''} aria-pressed={order === 'review'} title="Risky spots first, then what nobody asked for, then the biggest parts" onClick={() => updateSettings({ reviewOrder: 'review' })}>
                <ArrowDownUp size={12} /> Review order
              </button>
              <button type="button" className={order === 'file' ? 'on' : ''} aria-pressed={order === 'file'} title="By the first file each part touches" onClick={() => updateSettings({ reviewOrder: 'file' })}>
                <FileText size={12} /> File order
              </button>
            </div>
          )}
          {parts.map((p, i) => {
            const mk = marks[p.id]
            const was = carry.changed[p.id]
            return (
              <button key={p.id} className={`rc-part-item${i === index ? ' on' : ''}${mk ? ' marked' : ''}`} onClick={() => go(i)} aria-current={i === index}>
                <span className={`rc-num ${mk?.note ? 'back' : mk?.ok ? 'ok' : ''}`}>{mk?.note ? <Undo2 size={11} /> : mk?.ok ? <Check size={11} /> : i + 1}</span>
                <span className="rc-part-name">
                  <span className="rc-part-title">{p.title}</span>
                  <span className="rc-part-meta">
                    {p.id === startHere && parts.length > 1 && (
                      <span className="rc-start" title="Read this part first">
                        <MapPin size={10} /> Start here
                      </span>
                    )}
                    <span className={`rc-need ${p.need}`}>{NEED[p.need].label}</span>
                    <span>{p.lines} lines</span>
                    {was && <span className="rc-changed" title={`Its hunks changed after you ${was === 'approved' ? 'approved' : 'sent back'} it`}>changed</span>}
                    <span>{formatMinutes(partMinutes(p)).replace(/^about /, '~')}</span>
                    {p.flags.length > 0 && (
                      <span className={`rc-flag-dot${p.flags.some((f) => f.id === 'secret' || f.id === 'tests') ? ' bad' : ''}`} title={p.flags.map((f) => f.label).join(', ')}>
                        <ShieldAlert size={11} /> {p.flags.length}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            )
          })}
          {onlyNew && !parts.length && !noise.length && <p className="rc-since-empty muted">Nothing new to read: the change only lost hunks since you reviewed.</p>}
          {noise.length > 0 && (
            <button className={`rc-part-item noise${index === parts.length ? ' on' : ''}`} onClick={() => go(parts.length)}>
              <span className="rc-num">~</span>
              <span className="rc-part-name">
                <span className="rc-part-title">Noise</span>
                <span className="rc-part-meta">
                  {new Set(noise.map((h) => h.path)).size} files · {noise.reduce((a, h) => a + h.additions + h.deletions, 0)} lines, folded
                </span>
              </span>
            </button>
          )}
        </nav>
        <ReviewListResizer />

        <div className="rc-main" ref={main}>
          {current ? (
            <PartView
              key={current.id}
              source={source}
              part={current}
              n={index + 1}
              of={parts.length}
              start={current.id === startHere && parts.length > 1}
              last={index === parts.length - 1 && !noise.length}
              layout={layout}
              criteria={c.criteria}
              mark={marks[current.id]}
              changed={carry.changed[current.id]}
              partial={onlyNew ? { shown: current.hunks.length, of: fullOf(current).hunks.length } : undefined}
              radius={radius.filter((x) => current.hunks.some((h) => h.id === x.hunk))}
              capped={!!usesFound?.capped}
              editing={editing?.part === current.id ? editing.note : null}
              asking={asking?.part === current.id ? asking.q : null}
              onEdit={(note) => setEditing(note === null ? null : { part: current.id, note })}
              onAsk={(q) => setAsking(q === null ? null : { part: current.id, q })}
              onSave={saveNote}
              onSendAsk={() => void ask()}
              onOk={() => ok(current)}
              onPrev={() => go(index - 1)}
              onNext={() => go(index + 1)}
            />
          ) : (
            <NoiseView id={NOISE_ID} hunks={noise} cwd={source.cwd} layout={layout} />
          )}
        </div>
      </div>

      <footer className="rc-foot">
        <div className="rc-progress" title={`${seen} of ${t.lines} lines have a verdict`}>
          <div style={{ width: `${t.lines ? Math.round((seen / t.lines) * 100) : 0}%` }} />
        </div>
        <span className="rc-foot-text">
          Reviewed <strong>{seen.toLocaleString()}</strong> of {t.lines.toLocaleString()} lines
          {t.noise > 0 ? ` · ${t.noise.toLocaleString()} lines of noise skipped` : ''}
          {review?.sent ? ' · sent back once already' : ''}
        </span>
        <span className="spacer" />
        <span className="rc-keys muted">
          <kbd>J</kbd>/<kbd>K</kbd> next/previous · <kbd>A</kbd> looks good · <kbd>S</kbd> send back · <kbd>Q</kbd> ask
        </span>
        {back.length > 0 && source.mission ? (
          <button className="btn primary sm" disabled={busy || workingOn(source)} title={workingOn(source) ? 'The agent is still working' : `One follow-up to ${agentName} with each part's note`} onClick={() => void send()}>
            <Undo2 size={13} /> Send {back.length === 1 ? '1 part' : `${back.length} parts`} back to {agentName}
          </button>
        ) : c.parts.length > 0 && c.parts.every((p) => marks[p.id]?.ok) ? (
          <span className="rc-all-good">
            <Check size={13} /> Every part looks good
          </span>
        ) : null}
      </footer>
    </div>
  )
}

interface PartViewProps {
  source: ReviewSource
  part: Part
  n: number
  of: number
  /** the first part of the review order */
  start: boolean
  last: boolean
  layout: 'split' | 'unified'
  criteria: Cockpit['criteria']
  mark?: { ok?: boolean; note?: string }
  /** it had a verdict, and its hunks changed since */
  changed?: 'approved' | 'sent back'
  /** "Since last review": how many of its hunks are shown */
  partial?: { shown: number; of: number }
  radius: Radius[]
  capped: boolean
  editing: string | null
  asking: string | null
  onEdit: (note: string | null) => void
  onAsk: (q: string | null) => void
  onSave: () => void
  onSendAsk: () => void
  onOk: () => void
  onPrev: () => void
  onNext: () => void
}

function PartView(p: PartViewProps): React.JSX.Element {
  const { part, source } = p
  const asks = (source.review.asks ?? []).filter((a) => a.part === part.id)
  const byFile = groupByFile(part.hunks)
  return (
    <article className="rc-part" data-part={part.id}>
      <div className="rc-part-head">
        <span className="muted">
          Part {p.n} of {p.of}
        </span>
        {p.start && (
          <span className="rc-start" title="The review order puts this part first">
            <MapPin size={11} /> Start here
          </span>
        )}
        <span className="muted" title="Its lines at a reading pace, plus a second look for each flag">
          {formatMinutes(partMinutes(part))}
        </span>
        <span className={`rc-need ${part.need}`} title={NEED[part.need].hint}>
          {NEED[part.need].label}
        </span>
        {part.serves.length > 0 && <span className="muted">meets {part.serves.map((s) => `#${s}`).join(', ')}</span>}
      </div>
      <h2 className="rc-part-h">{part.title}</h2>
      {p.changed && (
        <div className="rc-changed-note">
          <History size={12} /> Changed since you {p.changed === 'approved' ? 'approved it' : 'sent it back'}: read it again.
        </div>
      )}
      {p.partial && p.partial.shown < p.partial.of && (
        <p className="rc-partial muted">
          Showing {p.partial.shown} of {p.partial.of} hunks: only what changed since you reviewed. Your verdict covers the whole part.
        </p>
      )}
      {part.why && <p className="rc-why selectable">{part.why}</p>}
      {part.serves.length > 0 && (
        <ul className="rc-serves">
          {part.serves.map((s) => (
            <li key={s}>
              <Check size={12} /> {p.criteria[s - 1]?.text}
            </li>
          ))}
        </ul>
      )}
      {(part.simpler || part.risk || part.flags.length > 0) && (
        <div className="rc-callouts">
          {part.simpler && (
            <div className="rc-callout simpler">
              <Lightbulb size={14} />
              <div>
                <strong>Could be simpler</strong>
                <p className="selectable">{part.simpler}</p>
              </div>
            </div>
          )}
          {part.risk && (
            <div className="rc-callout risk">
              <ShieldAlert size={14} />
              <div>
                <strong>What could break</strong>
                <p className="selectable">{part.risk}</p>
              </div>
            </div>
          )}
          {part.flags.length > 0 && (
            <div className="rc-flags">
              {part.flags.map((f) => (
                <span key={f.id} className={`rc-flag ${f.id === 'secret' || f.id === 'tests' ? 'bad' : ''}`} title={f.why}>
                  <ShieldAlert size={11} /> {f.label}
                  <span className="rc-flag-why">{f.why}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {p.radius.length > 0 && <BlastRadius radius={p.radius} capped={p.capped} cwd={source.cwd} />}

      {asks.length > 0 && (
        <div className="rc-asks">
          {asks.map((a) => (
            <div key={a.id} className="rc-ask-item">
              <div className="rc-q">
                <MessageCircleQuestion size={13} /> {a.q}
              </div>
              {a.a !== undefined ? (
                <div className="rc-a selectable">
                  <span className="muted">{getAgent(a.agent).name}:</span> {a.a}
                </div>
              ) : a.failed ? (
                <div className="rc-a muted">{getAgent(a.agent).name} didn't answer.</div>
              ) : (
                <div className="rc-a muted">
                  <LoaderCircle size={12} className="spin" /> {getAgent(a.agent).name} is looking…
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rc-actions">
        <button className={`btn sm${p.mark?.ok ? ' on-ok' : ''}`} aria-pressed={!!p.mark?.ok} onClick={p.onOk} title="Looks good (A)">
          <Check size={13} /> Looks good
        </button>
        <button className={`btn sm${p.mark?.note ? ' on-back' : ''}`} onClick={() => p.onEdit(p.mark?.note ?? '')} title="Send back with a note (S)">
          <Undo2 size={13} /> {p.mark?.note ? 'Edit note' : 'Send back…'}
        </button>
        {part.need === 'extra' && !p.mark?.note && (
          <button className="btn sm" title="Send it back to be removed" onClick={() => p.onEdit(CUT_NOTE)}>
            <Scissors size={13} /> Cut it
          </button>
        )}
        <button className="btn sm" onClick={() => p.onAsk('')} title={`Ask ${getAgent(firstAgent(source)).name} about this part (Q)`}>
          <CircleHelp size={13} /> Ask why
        </button>
        <span className="spacer" />
        <button className="icon-btn" disabled={p.n === 1} onClick={p.onPrev} title="Previous part (K)" aria-label="Previous part">
          <ArrowLeft size={14} />
        </button>
        <button className="btn sm" disabled={p.last} onClick={p.onNext} title="Next part (J)">
          Next <ArrowRight size={13} />
        </button>
      </div>
      {p.mark?.note && p.editing === null && (
        <div className="rc-note">
          <Undo2 size={12} /> {p.mark.note}
        </div>
      )}
      {p.editing !== null && (
        <form
          className="rc-form"
          onSubmit={(e) => {
            e.preventDefault()
            p.onSave()
          }}
        >
          <textarea
            autoFocus
            rows={2}
            value={p.editing}
            aria-label="What to change in this part"
            placeholder="What should change here? It goes to the agent with this part's files."
            onChange={(e) => p.onEdit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) p.onSave()
              if (e.key === 'Escape') p.onEdit(null)
            }}
          />
          <div className="rc-form-row">
            <span className="muted">Collected with the other parts; nothing is sent until you click Send back.</span>
            <button className="btn sm ghost" type="button" onClick={() => p.onEdit(null)}>
              Cancel
            </button>
            <button className="btn sm primary" type="submit">
              {p.editing.trim() ? 'Save note' : 'Clear'}
            </button>
          </div>
        </form>
      )}
      {p.asking !== null && (
        <form
          className="rc-form"
          onSubmit={(e) => {
            e.preventDefault()
            p.onSendAsk()
          }}
        >
          <input
            autoFocus
            value={p.asking}
            aria-label="Your question about this part"
            placeholder="Why is this needed? Could it reuse what's there?"
            onChange={(e) => p.onAsk(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && p.onAsk(null)}
          />
          <div className="rc-form-row">
            <span className="muted">A read-only {getAgent(firstAgent(source)).name} answers with this part and the task; nothing changes.</span>
            <button className="btn sm ghost" type="button" onClick={() => p.onAsk(null)}>
              Cancel
            </button>
            <button className="btn sm primary" type="submit" disabled={!p.asking.trim()}>
              Ask
            </button>
          </div>
        </form>
      )}

      {byFile.map(([path, hunks]) => (
        <HunkFile key={path} path={path} hunks={hunks} cwd={source.cwd} layout={p.layout} />
      ))}
    </article>
  )
}

const SHOWN = 30

/** Callers of what this part changed that the change didn't touch: where a changed signature or a removed name may still be used the old way. */
function BlastRadius({ radius, capped, cwd }: { radius: Radius[]; capped: boolean; cwd: string }): React.JSX.Element {
  return (
    <section className="rc-blast" aria-label="Blast radius">
      <div className="field-label">
        <Network size={11} /> Blast radius
      </div>
      {radius.map((r) => {
        const risky = r.kind !== 'body' && r.untouched.length > 0
        return (
          <details key={r.name} className={`rc-blast-name${risky ? ' risky' : ''}`} open={risky}>
            <summary>
              <code>{r.name}</code>
              {r.kind === 'removed' ? ' was removed but ' : ' '}
              {r.kind === 'removed' ? 'is still named in' : 'is used in'} {r.uses} other {r.uses === 1 ? 'place' : 'places'}, {r.changed} changed
              {r.kind === 'signature' && <span className="rc-blast-kind">signature changed</span>}
            </summary>
            {r.untouched.length > 0 ? (
              <ul>
                {r.untouched.slice(0, SHOWN).map((u: Use) => (
                  <li key={`${u.path}:${u.line}`}>
                    <button className="rc-blast-use" title="Open in the editor" onClick={() => void openFileAt(`${cwd}/${u.path}`, u.line)}>
                      <span className="mono rc-blast-at">
                        {u.path}:{u.line}
                      </span>
                      <span className="mono rc-blast-text">{u.text.trim()}</span>
                    </button>
                  </li>
                ))}
                {r.untouched.length > SHOWN && <li className="muted">and {r.untouched.length - SHOWN} more</li>}
              </ul>
            ) : (
              <p className="muted">Every place that uses it was changed too.</p>
            )}
          </details>
        )
      })}
      {capped && <p className="muted">The search stopped early; there may be more.</p>}
    </section>
  )
}

function HunkFile({ path, hunks, cwd, layout }: { path: string; hunks: Hunk[]; cwd: string; layout: 'split' | 'unified' }): React.JSX.Element {
  const add = hunks.reduce((a, h) => a + h.additions, 0)
  const del = hunks.reduce((a, h) => a + h.deletions, 0)
  const lines = useMemo(() => hunks.flatMap((h) => [{ kind: 'hunk' as const, text: h.header }, ...h.lines]), [hunks])
  const status = hunks[0].status
  return (
    <section className="diff-section rc-file">
      <header className="diff-file-head">
        <span className={`diff-status ${status}`}>{status}</span>
        <span className="mono diff-file-path" title={path}>{path}</span>
        <span className="add">+{add}</span>
        <span className="del">−{del}</span>
        <span className="spacer" />
        {status !== 'deleted' && (
          <button className="icon-btn" title="Open the file" aria-label="Open the file" onClick={() => void openFileAt(`${cwd}/${path}`, hunks[0].lines.find((l) => l.newNo)?.newNo)}>
            <ExternalLink size={13} />
          </button>
        )}
      </header>
      {lines.length > 1 && <DiffLines lines={lines} layout={layout} open={(n) => void openFileAt(`${cwd}/${path}`, n)} />}
    </section>
  )
}

function NoiseView({ hunks, cwd, layout }: { id: string; hunks: Hunk[]; cwd: string; layout: 'split' | 'unified' }): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const files = groupByFile(hunks)
  return (
    <article className="rc-part">
      <h2 className="rc-part-h">Noise</h2>
      <p className="rc-why">Lockfiles, generated files and changes that only reformat or reorder lines. Folded so you can skip them; open one if you want to check.</p>
      <ul className="rc-noise">
        {files.map(([path, hs]) => (
          <li key={path}>
            <button className="rc-noise-row" onClick={() => setOpen(open === path ? null : path)} aria-expanded={open === path}>
              <ChevronDown size={12} className={open === path ? '' : 'rot'} />
              <span className="mono">{path}</span>
              <span className="muted">{[...new Set(hs.map((h) => h.noise))].join(', ')}</span>
              <span className="spacer" />
              <span className="add">+{hs.reduce((a, h) => a + h.additions, 0)}</span>
              <span className="del">−{hs.reduce((a, h) => a + h.deletions, 0)}</span>
            </button>
            {open === path && <HunkFile path={path} hunks={hs} cwd={cwd} layout={layout} />}
          </li>
        ))}
      </ul>
    </article>
  )
}

function groupByFile(hunks: Hunk[]): Array<[string, Hunk[]]> {
  const m = new Map<string, Hunk[]>()
  for (const h of hunks) m.set(h.path, [...(m.get(h.path) ?? []), h])
  return [...m.entries()]
}
