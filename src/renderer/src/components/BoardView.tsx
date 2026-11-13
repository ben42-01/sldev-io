import { clearColumnFlow } from '../lib/removals'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SkillsHint } from './SkillsHint'
import { ArrowUp, ArrowDown, Bot, Brain, Check, CheckCheck, CircleDot, ClipboardCopy, Ellipsis, Factory, GitPullRequest, Hourglass, Link2, ListChecks, Play, Plus, RefreshCw, Network, Search, Settings2, Sparkles, SquareKanban, Tag, Trash2 } from 'lucide-react'
import { BOARD_COLUMNS, blockersOf, boardLabels, columnItems, dependentsOf, importableIssues, matchesItem, parseKeys, parseLabels, releaseNotes, spentText, spentTotal, unreleased, wouldCycle, type BoardColumn, type BoardItem, type BoardPriority, type BoardWork, type StoryJob, type WorkState } from '@shared/board'
import { missionSignal, runSignal, type Signal } from '@shared/status'
import { openMissionDetails } from './MissionDetails'
import { Modal, confirmAction } from './Modal'
import { showContextMenu, type MenuItem } from './ContextMenu'
import { StatusDot } from './StatusDot'
import { Empty, ErrorBanner, Loading } from './States'
import { useAgents } from '../state/agents'
import { addItem, approve, board, getItem, importIssues, markReleased, missionsOf, moveTo, prDescriptionOf, refreshPrs, removeItem, saveBoardSettings, startItem, startRetro, syncBoardFiles, updateItem, useBoardItems, useBoardSettings, useStoryJobs, workOf, writeStories } from '../state/board'
import { toast } from './Toast'
import { activatePanel, activePanelId } from '../dock/dockApi'
import { createStore } from '../state/store'
import type { GhIssue } from '@shared/types'
import { factory, loadRecipes, openPipeline } from '../state/factory'
import { useKinds } from '../state/missionKinds'
import { missions, reviewMission } from '../state/missions'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'

/** The board's dialogs, opened from the cards, the toolbar or the Board panel's menu. */
export type BoardDialog = { type: 'edit'; item?: string; column: BoardColumn } | { type: 'pickup' } | { type: 'import' } | { type: 'stories'; card?: string } | { type: 'release' }
const dialog = createStore<{ open: BoardDialog | null }>({ open: null })
export const openBoardDialog = (d: BoardDialog): void => dialog.set({ open: d })
const closeDialog = (): void => dialog.set({ open: null })

/**
 * The work board: Backlog → Proposed → Agent ready → In progress → Review → Done. Agents write stories
 * into Proposed; you approve them; with pick-up on, the factory takes Agent ready cards on its own and
 * every card shows the run or mission working on it.
 */
export function BoardView({ root }: { root: string | null }): React.JSX.Element {
  const items = useBoardItems(root)
  const settings = useBoardSettings(root)
  const jobs = useStoryJobs(root)
  const [query, setQuery] = useState('')
  const [label, setLabel] = useState<string | null>(null)
  const open = useStore(dialog, (d) => d.open)
  const setEditing = (i: BoardItem | { column: BoardColumn }): void => openBoardDialog({ type: 'edit', item: 'id' in i ? i.id : undefined, column: i.column })
  // re-render cards when their runs and missions change
  useStore(missions, (s) => s.list)
  useStore(factory, (s) => s.runs)
  useEffect(() => void loadRecipes(root), [root])
  const labels = useMemo(() => boardLabels(items), [items])
  const shown = items.filter((i) => matchesItem(i, query, label))
  const syncError = useStore(board, (b) => (root ? b.syncError[root] : ''))

  if (!root) return <Empty big icon={<SquareKanban size={22} />} title="No folder open" hint="Open a project folder to plan work for its agents." />

  const togglePickup = (on: boolean): void => saveBoardSettings({ ...settings, root, pickup: on })

  return (
    <div className="panel-page mc-page board-page">
      <div className="board-filters">
        <label className="board-search">
          <Search size={13} />
          <input placeholder="Filter cards, #12…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter cards" />
        </label>
        {labels.length > 0 && (
          <div className="board-labels" role="group" aria-label="Filter by label">
            {labels.slice(0, 8).map((l) => (
              <button key={l} type="button" className={`board-label${label === l ? ' on' : ''}`} aria-pressed={label === l} onClick={() => setLabel(label === l ? null : l)}>
                {l}
              </button>
            ))}
          </div>
        )}
        <span className="grow" />
        <label className={`chip-check${settings.pickup ? ' on' : ''}`} title="Take cards from Agent ready on their own, while the app is open">
          <input type="checkbox" checked={settings.pickup} onChange={(e) => togglePickup(e.target.checked)} aria-label="Auto pick-up" />
          Auto pick-up
        </label>
        <button className="btn sm" onClick={() => openBoardDialog({ type: 'pickup' })} title="What starts for a card, and how many at once">
          <Settings2 size={13} /> <span className="board-work-summary">{workLabel(settings.work)} · {settings.parallel} at a time</span>
        </button>
        <button className="btn sm" onClick={() => setEditing({ column: 'backlog' })}>
          <Plus size={13} /> New card
        </button>
      </div>
      {syncError && (
        <ErrorBanner onRetry={syncBoardFiles}>{syncError}</ErrorBanner>
      )}
      <div className="board-columns">
        {BOARD_COLUMNS.map((c) => (
          <Column key={c.id} column={c} items={columnItems(shown, c.id)} all={items} total={items.filter((i) => i.column === c.id).length} root={root} pickup={settings.pickup} onOpen={setEditing} jobs={c.id === 'proposed' ? jobs.filter((j) => !j.done) : []} />
        ))}
      </div>
      {open?.type === 'edit' && <ItemDialog root={root} item={open.item ? getItem(open.item) : undefined} column={open.column} onClose={closeDialog} />}
      {open?.type === 'pickup' && <PickupDialog root={root} onClose={closeDialog} />}
      {open?.type === 'import' && <ImportDialog root={root} onClose={closeDialog} />}
      {open?.type === 'stories' && <StoriesDialog root={root} card={open.card ? getItem(open.card) : undefined} onClose={closeDialog} />}
      {open?.type === 'release' && <ReleaseDialog root={root} onClose={closeDialog} />}
    </div>
  )
}

const DRAG = 'application/x-sldev-board'

function Column({ column, items, all, total, root, pickup, onOpen, jobs }: { column: (typeof BOARD_COLUMNS)[number]; items: BoardItem[]; all: BoardItem[]; total: number; root: string; pickup: boolean; onOpen: (i: BoardItem) => void; jobs: StoryJob[] }): React.JSX.Element {
  const [over, setOver] = useState(false)
  const [adding, setAdding] = useState(false)
  const quick = column.id === 'backlog' || column.id === 'ready'
  return (
    <section
      className={`board-column${over ? ' over' : ''}`}
      data-column={column.id}
      aria-label={column.title}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const id = e.dataTransfer.getData(DRAG)
        if (id) moveTo(id, column.id)
      }}
    >
      <h3 className="mc-column-head">
        {column.title}
        {column.id === 'ready' && <span className={`board-pickup${pickup ? ' on' : ''}`} title={pickup ? 'Auto pick-up is on' : 'Auto pick-up is off: start cards with ▶'}>{pickup ? 'auto' : 'manual'}</span>}
        <span className="seg-count">{total}</span>
        {column.id === 'done' && items.length > 0 && (
          <button type="button" className="icon-btn board-approve-all" title={`Release notes from Done${(() => { const t = spentTotal(items); return t ? ` · all of it took ${spentText(t)}` : '' })()}`} aria-label="Release notes" onClick={() => openBoardDialog({ type: 'release' })}>
            <Tag size={13} />
          </button>
        )}
        {column.id === 'done' && total > 0 && (
          <button type="button" className="icon-btn board-approve-all" title={`Clear Done: delete all ${total} cards and their worktrees`} aria-label="Clear Done" onClick={() => void clearColumnFlow(root, 'done')}>
            <Trash2 size={13} />
          </button>
        )}
        {column.id === 'proposed' && items.length > 1 && (
          <button type="button" className="icon-btn board-approve-all" title="Approve all shown: move them to Agent ready" aria-label="Approve all" onClick={() => approve(items.map((i) => i.id))}>
            <CheckCheck size={13} />
          </button>
        )}
      </h3>
      <div className="board-column-body">
        {jobs.map((j) => <JobRow key={j.mission} job={j} />)}
        {items.map((i) => <Card key={i.id} item={i} all={all} onOpen={() => onOpen(i)} />)}
        {!items.length && !adding && !jobs.length && (
          <div className="mc-column-empty">
            <span className="muted small">{column.hint}{column.id === 'proposed' && <> <SkillsHint skill="sldev-stories" what="stories" /></>}</span>
            {column.id === 'proposed' && <button className="btn sm" onClick={() => openBoardDialog({ type: 'stories' })}><Sparkles size={12} /> Write stories</button>}
          </div>
        )}
        {quick && (adding ? <QuickAdd root={root} column={column.id} onDone={() => setAdding(false)} /> : (
          <button type="button" className="board-add" onClick={() => setAdding(true)}>
            <Plus size={12} /> Add a card
          </button>
        ))}
      </div>
    </section>
  )
}

function QuickAdd({ root, column, onDone }: { root: string; column: BoardColumn; onDone: () => void }): React.JSX.Element {
  const [title, setTitle] = useState('')
  const add = (): void => {
    const t = title.trim()
    if (!t) return onDone()
    addItem(root, { title: t, body: '', labels: [], priority: 'normal', column })
    setTitle('')
  }
  return (
    <form className="board-quick" onSubmit={(e) => (e.preventDefault(), add())}>
      <input
        autoFocus
        placeholder="What needs doing? Enter adds"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onDone()}
        onBlur={() => !title.trim() && onDone()}
        aria-label="New card title"
      />
    </form>
  )
}

const STATE_SIGNAL: Record<WorkState, Signal> = {
  working: { tone: 'working', label: 'Working', pulse: true },
  'needs-you': { tone: 'attention', label: 'Needs you', pulse: true },
  finished: { tone: 'review', label: 'Ready for review', pulse: false },
  failed: { tone: 'error', label: 'Failed', pulse: false }
}

/** One line about the card's run or mission: what it is and where it stands. */
function workLine(i: BoardItem): { signal: Signal; text: string; open?: () => void } | null {
  if (!i.started) return null
  if (!i.started.id) return { signal: STATE_SIGNAL.working, text: 'Starting…' }
  const w = workOf(i)
  if (!w) return i.state ? { signal: STATE_SIGNAL[i.state], text: 'Its run was removed' } : null
  if (w.run) {
    const nodes = Object.values(w.run.nodes)
    const waiting = nodes.some((n) => n.status === 'approval')
    const done = nodes.filter((n) => n.status === 'done').length
    const pr = w.run.pr ? ` · PR #${w.run.pr.number}` : ''
    return { signal: runSignal(w.run.status, waiting), text: `${w.run.recipe.name} · ${done}/${nodes.length} stages${waiting ? ' · waiting for you' : ''}${pr}`, open: () => openPipeline(w.run!.id) }
  }
  const m = w.mission!
  return { signal: missionSignal(m.status), text: `${m.kind?.name ?? 'Mission'} · ${missionSignal(m.status).label}`, open: () => openMissionDetails(m.id) }
}

/** A story-writing mission at the top of Proposed, until it reports. */
function JobRow({ job }: { job: StoryJob }): React.JSX.Element | null {
  const m = useStore(missions, (s) => s.list.find((x) => x.id === job.mission))
  if (!m) return null
  const signal = missionSignal(m.status)
  return (
    <button type="button" className="board-job" onClick={() => openMissionDetails(m.id)} title="Open the mission">
      <StatusDot signal={signal} small />
      <span className="board-job-text">
        <span>{job.card ? 'Refining' : 'Writing stories'} · {signal.label}{job.filed ? ` · ${job.filed} filed` : ''}</span>
        <span className="muted small">{job.feature.split('\n')[0]}</span>
      </span>
    </button>
  )
}

function Card({ item: i, all, onOpen }: { item: BoardItem; all: BoardItem[]; onOpen: () => void }): React.JSX.Element {
  const work = workLine(i)
  const startable = (i.column === 'backlog' || i.column === 'ready') && !i.started && !i.refining
  const proposed = i.column === 'proposed'
  const refinable = (i.column === 'backlog' || proposed) && !i.refining
  const waits = blockersOf(i, all)
  const unblocks = waits.length ? [] : dependentsOf(i, all).filter((x) => x.column !== 'done')
  const finished = !!i.started?.id && (i.state === 'finished' || i.state === 'failed')
  const retroBusy = !!i.retro && !i.retro.done
  // the mission whose change is up for review: the newest one that did the work (a follow-up, a takeover, the Lead)
  const reviewable = i.column === 'review' && i.started?.type === 'mission' ? missionsOf(i).filter((m) => !m.delegate && !m.explains && m.parent?.kind !== 'second-opinion').sort((a, b) => a.createdAt - b.createdAt).pop() : undefined
  const copyPr = (): void =>
    void prDescriptionOf(i.id).then((md) => window.api.clipboard.writeText(md)).then(() => toast('Copied the pull request description'))
  const menu = (): MenuItem[] => [
    { label: 'Edit…', run: onOpen },
    ...(proposed ? [{ label: 'Approve for agents', icon: <Check size={13} />, run: () => approve([i.id]) }] : []),
    ...(refinable ? [{ label: 'Refine with an agent…', icon: <Sparkles size={13} />, run: () => openBoardDialog({ type: 'stories', card: i.id }) }] : []),
    ...(startable ? [
      { label: waits.length ? `Start now, without waiting for ${waits.map((x) => `#${x.key}`).join(', ')}` : 'Start now', icon: <Play size={13} />, run: () => void startItem(i.id) },
      { label: 'Start with a Lead (it delegates the parts)', icon: <Network size={13} />, run: () => (updateItem(i.id, { work: { type: 'mission', kind: 'lead', brief: '' } }), void startItem(i.id)) }
    ] : []),
    ...(reviewable ? [{ label: 'Review the change', icon: <ListChecks size={13} />, run: () => reviewMission(reviewable.id) }] : []),
    ...(work?.open ? [{ label: i.started?.type === 'run' ? 'Open pipeline' : 'Open mission', run: work.open }] : []),
    ...(i.started?.id || i.column === 'review' || i.column === 'done' ? [{ label: 'Copy as PR description', icon: <ClipboardCopy size={13} />, run: copyPr }] : []),
    ...(finished ? [{ label: i.retro?.done ? 'Run the retro again…' : 'Retro: save lessons to memory', icon: <Brain size={13} />, disabled: retroBusy, run: () => void startRetro(i.id).then(() => toast('A retro mission is looking back at this card')).catch((e: Error) => toast(e.message)) }] : []),
    ...(prOf(i) ? [
      { label: `Open PR #${prOf(i)!.number} on GitHub`, icon: <GitPullRequest size={13} />, run: () => void window.api.shell.openExternal(prOf(i)!.url) },
      { label: 'Check pull requests now', icon: <RefreshCw size={13} />, run: refreshPrs }
    ] : []),
    ...(i.issue ? [{ label: `Open issue #${i.issue.number} on GitHub`, icon: <CircleDot size={13} />, run: () => void window.api.shell.openExternal(i.issue!.url) }] : []),
    { type: 'separator' },
    { type: 'header', label: 'Move to' },
    ...BOARD_COLUMNS.filter((c) => c.id !== i.column).map((c): MenuItem => ({ label: c.title, run: () => moveTo(i.id, c.id) })),
    { type: 'separator' },
    { label: 'Delete card…', icon: <Trash2 size={13} />, run: () => void removeCardFlow(i) }
  ]
  return (
    <article
      className={`board-card${i.state ? ` ${i.state}` : ''}`}
      draggable
      data-id={i.id}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG, i.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => e.dataTransfer.types.includes(DRAG) && e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(DRAG)
        if (!id || id === i.id) return
        e.preventDefault()
        e.stopPropagation()
        moveTo(id, i.column, i.id)
      }}
      onContextMenu={(e) => showContextMenu(e, menu())}
    >
      <div className="board-card-head">
        <span className="board-key">#{i.key}</span>
        {i.issue && <span className="board-issue" title={`GitHub issue #${i.issue.number}`}><CircleDot size={11} /> {i.issue.number}</span>}
        {i.priority !== 'normal' && (
          <span className={`board-priority ${i.priority}`} title={`${i.priority === 'high' ? 'High' : 'Low'} priority`}>
            {i.priority === 'high' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
          </span>
        )}
        {i.by && <span className="board-by" title={`Written by ${i.by}`}><Sparkles size={11} /> {i.by}</span>}
        {i.retro?.done && <span className="board-by" title={i.retro.lessons ? `A retro saved ${i.retro.lessons} lesson${i.retro.lessons === 1 ? '' : 's'} to the project memory` : 'A retro found nothing worth remembering'}><Brain size={11} /> {i.retro.lessons ?? 0}</span>}
        {i.work && <span className="board-own" title={`Runs ${workLabel(i.work)} instead of the board's setting`}>{i.work.type === 'recipe' ? <Factory size={11} /> : <Bot size={11} />}</span>}
        <span className="grow" />
        <button className="icon-btn" title="More" aria-label="More" onClick={(e) => showContextMenu(e, menu())}>
          <Ellipsis size={13} />
        </button>
      </div>
      <button type="button" className="board-title" onClick={onOpen} title="Edit">{i.title}</button>
      {i.labels.length > 0 && <div className="board-card-labels">{i.labels.map((l) => <span key={l} className="board-label static">{l}</span>)}</div>}
      {i.note && <div className={`board-note${i.column === 'backlog' ? ' error' : ''}`}>{i.note}</div>}
      {waits.length > 0 && i.column !== 'done' && (
        <div className="board-waits" title="Pick-up starts it once these are Done">
          <Hourglass size={11} /> Waits for {waits.map((x) => <span key={x.id} className="board-key">#{x.key}</span>)}
        </div>
      )}
      {unblocks.length > 0 && i.column !== 'done' && (
        <div className="board-waits unblocks" title="These wait for this card">
          <Link2 size={11} /> Unblocks {unblocks.map((x) => <span key={x.id} className="board-key">#{x.key}</span>)}
        </div>
      )}
      {i.spent && (i.column === 'review' || i.column === 'done') && <div className="board-spent" title="From start to finish, and the tokens in the agents' own logs at API list prices">{spentText(i.spent)}</div>}
      {(work || startable || proposed || i.refining || retroBusy) && (
        <div className="board-card-foot">
          {i.refining ? <RefiningLine mission={i.refining} /> : retroBusy ? <RefiningLine mission={i.retro!.mission} label="Retro" /> : work ? (
            <button type="button" className="board-work" onClick={work.open} disabled={!work.open} title={work.open ? 'Open it' : undefined}>
              <StatusDot signal={work.signal} small />
              <span>{work.text}</span>
            </button>
          ) : <span className="grow" />}
          {startable && (
            <button className="btn sm" onClick={() => void startItem(i.id)} disabled={waits.length > 0} title={waits.length ? `Waits for ${waits.map((x) => `#${x.key}`).join(', ')} (start it anyway from the ⋯ menu)` : 'Start its run now'}>
              <Play size={12} /> Start
            </button>
          )}
          {reviewable && (
            <button className="btn sm" onClick={() => reviewMission(reviewable.id)} title="The change part by part: why each is there, and whether it was asked for">
              <ListChecks size={12} /> Review
            </button>
          )}
          {proposed && !i.refining && (
            <button className="btn sm" onClick={() => approve([i.id])} title="Move it to Agent ready">
              <Check size={12} /> Approve
            </button>
          )}
        </div>
      )}
    </article>
  )
}

function RefiningLine({ mission, label = 'Refining' }: { mission: string; label?: string }): React.JSX.Element {
  const m = useStore(missions, (s) => s.list.find((x) => x.id === mission))
  const signal = m ? missionSignal(m.status) : STATE_SIGNAL.working
  return (
    <button type="button" className="board-work" onClick={() => m && openMissionDetails(m.id)} disabled={!m} title="Open the mission">
      <StatusDot signal={signal} small />
      <span>{label} · {signal.label}</span>
    </button>
  )
}

const prOf = (i: BoardItem): { number: number; url: string } | undefined => (i.started?.type === 'run' ? workOf(i)?.run?.pr : undefined)

/** Open GitHub issues as cards: pick which, and the column they land in. */
function ImportDialog({ root, onClose }: { root: string; onClose: () => void }): React.JSX.Element {
  const [label, setLabel] = useState('')
  const [issues, setIssues] = useState<GhIssue[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [column, setColumn] = useState<BoardColumn>('backlog')
  const load = (): void => {
    setIssues(null)
    setError(null)
    window.api.gh
      .issues(root, label.trim() || undefined)
      .then((all) => {
        const fresh = importableIssues(board.get().items, root, all)
        setIssues(all)
        setPicked(new Set(fresh.map((x) => x.number)))
      })
      .catch((e: Error) => setError(e.message))
  }
  useEffect(load, [])
  const onBoard = new Set(issues ? issues.filter((x) => !importableIssues(board.get().items, root, [x]).length).map((x) => x.number) : [])
  const toggle = (n: number): void => setPicked((p) => {
    const next = new Set(p)
    if (next.has(n)) next.delete(n)
    else next.add(n)
    return next
  })
  const go = (): void => {
    importIssues(root, (issues ?? []).filter((x) => picked.has(x.number)), column)
    onClose()
  }
  return (
    <Modal
      title="Import GitHub issues"
      size="md"
      onClose={onClose}
      onSubmit={go}
      footerNote="Asked through your GitHub CLI. A card's factory run closes its issue with the pull request."
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!picked.size}>Import {picked.size || ''}</button>
        </>
      }
    >
      <div className="form board-form">
        <div className="field-row">
          <label className="field">
            <span>Label</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), load())} placeholder="Any label, e.g. agent-ready" />
          </label>
          <label className="field">
            <span>Into</span>
            <select value={column} onChange={(e) => setColumn(e.target.value as BoardColumn)}>
              <option value="backlog">Backlog</option>
              <option value="ready">Agent ready</option>
            </select>
          </label>
        </div>
        <button type="button" className="btn sm board-import-load" onClick={load}><RefreshCw size={12} /> Load issues</button>
        {error ? <ErrorBanner onRetry={load}>{error}</ErrorBanner> : !issues ? <Loading what="Asking GitHub…" /> : !issues.length ? (
          <div className="mc-column-empty"><span className="muted small">No open issues{label.trim() ? ` with the label “${label.trim()}”` : ''}.</span></div>
        ) : (
          <ul className="board-import-list">
            {issues.map((x) => (
              <li key={x.number}>
                <label className={`check${onBoard.has(x.number) ? ' muted' : ''}`}>
                  <input type="checkbox" checked={picked.has(x.number)} disabled={onBoard.has(x.number)} onChange={() => toggle(x.number)} />
                  <span className="board-import-num">#{x.number}</span>
                  <span className="board-import-title">{x.title}</span>
                  {onBoard.has(x.number) ? <span className="muted small">on the board</span> : (x.labels ?? []).slice(0, 3).map((l) => <span key={l} className="board-label static">{l}</span>)}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

/** Ask an agent for well-defined stories: from a feature description, or by refining one card. */
function StoriesDialog({ root, card, onClose }: { root: string; card?: BoardItem; onClose: () => void }): React.JSX.Element {
  const agents = useAgents()
  const [feature, setFeature] = useState('')
  const [agent, setAgent] = useState('')
  const [max, setMax] = useState(6)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const go = async (): Promise<void> => {
    if (!card && !feature.trim()) return
    setBusy(true)
    const front = activePanelId()
    try {
      await writeStories(root, { feature, agent: agent || undefined, max, card: card?.id })
      onClose()
    } catch (e) {
      setError((e as Error).message.split('\n')[0])
    } finally {
      setBusy(false)
      // the board stays in front: the agent's terminal waits as a tab, its progress shows in Proposed
      if (front) activatePanel(front)
    }
  }
  return (
    <Modal
      title={card ? `Refine #${card.key}` : 'Write stories'}
      size="md"
      onClose={onClose}
      onSubmit={() => void go()}
      initialFocus={ref}
      footerNote="A read-only mission: the agent reads the code and nothing is changed. Its stories wait in Proposed until you approve them."
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || (!card && !feature.trim())}><Sparkles size={13} /> {card ? 'Refine' : 'Write stories'}</button>
        </>
      }
    >
      <div className="form board-form">
        {card && (
          <div className="board-refine-card">
            <span className="board-key">#{card.key}</span> {card.title}
          </div>
        )}
        <label className="field">
          <span>{card ? 'Anything to add' : 'Feature, epic or problem'}</span>
          <textarea ref={ref} rows={card ? 3 : 6} value={feature} onChange={(e) => setFeature(e.target.value)} placeholder={card ? 'Optional: what the agent should know, e.g. keep the old endpoint working' : 'e.g. Teams: users can create a team, invite people by email, and share projects with it. Owners can remove members.'} />
          <span className="field-hint">The agent reads the code, then writes each story with why, what to change, acceptance criteria and how to check it.</span>
        </label>
        <div className="field-row">
          <label className="field">
            <span>Agent</span>
            <select value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">Default ({agents.find((a) => a.id === workspace.get().defaultAgent)?.name ?? 'Claude Code'})</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          {!card && (
            <label className="field">
              <span>At most</span>
              <select value={max} onChange={(e) => setMax(Number(e.target.value))}>
                {[3, 6, 10, 15].map((n) => <option key={n} value={n}>{n} stories</option>)}
              </select>
            </label>
          )}
        </div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </div>
    </Modal>
  )
}

/** Release notes from the Done cards that haven't gone out yet: copy them, and mark them released. */
function ReleaseDialog({ root, onClose }: { root: string; onClose: () => void }): React.JSX.Element {
  const items = useBoardItems(root)
  const cards = unreleased(items)
  const [version, setVersion] = useState('')
  const [text, setText] = useState<string | null>(null)
  const title = version.trim() || 'What’s new'
  const notes = text ?? releaseNotes(cards, title)
  const total = spentTotal(cards)
  const copy = async (mark: boolean): Promise<void> => {
    await window.api.clipboard.writeText(notes)
    if (mark) markReleased(cards.map((c) => c.id), title)
    toast(mark ? `Copied, and ${cards.length} card${cards.length === 1 ? '' : 's'} marked as released in ${title}` : 'Copied the release notes')
    if (mark) onClose()
  }
  return (
    <Modal
      title="Release notes"
      size="md"
      onClose={onClose}
      onSubmit={() => void copy(true)}
      footerNote={`From the ${cards.length} Done card${cards.length === 1 ? '' : 's'} not in earlier notes, grouped by label${total ? `. Together they took ${spentText(total)}` : ''}.`}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" disabled={!cards.length} onClick={() => void copy(false)}><ClipboardCopy size={13} /> Copy</button>
          <button type="submit" className="btn primary" disabled={!cards.length}><Tag size={13} /> Copy and mark released</button>
        </>
      }
    >
      <div className="form board-form">
        <label className="field">
          <span>Version</span>
          <input value={version} onChange={(e) => (setVersion(e.target.value), setText(null))} placeholder="e.g. 1.4.0" aria-label="Version" />
          <span className="field-hint">Marking them released starts the next notes after these cards.</span>
        </label>
        {cards.length ? (
          <label className="field">
            <span>Notes</span>
            <textarea className="board-release-notes" rows={12} value={notes} onChange={(e) => setText(e.target.value)} aria-label="Release notes" />
          </label>
        ) : (
          <div className="mc-column-empty"><span className="muted small">Nothing in Done since the last release notes.</span></div>
        )}
      </div>
    </Modal>
  )
}

async function removeCardFlow(i: BoardItem): Promise<void> {
  const ok = await confirmAction({
    title: `Delete card #${i.key}?`,
    message: i.title,
    removes: ['The card, its details and labels'],
    keeps: i.started ? ['The run or mission it started, its branch and worktree'] : undefined,
    confirmLabel: 'Delete card',
    danger: true
  })
  if (ok) removeItem(i.id)
}

export function workLabel(w: BoardWork): string {
  return w.type === 'recipe' ? w.recipe : `${w.kind.slice(0, 1).toUpperCase()}${w.kind.slice(1)} mission`
}

/** The same choice automations offer: a recipe, or a mission of a kind on an agent. */
function WorkFields({ work, onChange }: { work: BoardWork; onChange: (w: BoardWork) => void }): React.JSX.Element {
  const recipes = useStore(factory, (s) => s.recipes)
  const kinds = useKinds()
  const agents = useAgents()
  return (
    <>
      <div className="seg sm" role="radiogroup" aria-label="Runs">
        <button type="button" role="radio" aria-checked={work.type === 'recipe'} className={work.type === 'recipe' ? 'on' : ''} disabled={!recipes.length} onClick={() => onChange({ type: 'recipe', recipe: recipes[0]?.recipe.name ?? '', intent: '' })}>
          <Factory size={12} /> Factory recipe
        </button>
        <button type="button" role="radio" aria-checked={work.type === 'mission'} className={work.type === 'mission' ? 'on' : ''} onClick={() => onChange({ type: 'mission', kind: 'build', brief: '' })}>
          <Bot size={12} /> Mission
        </button>
      </div>
      {work.type === 'recipe' ? (
        <label className="field">
          <span>Recipe</span>
          <select value={work.recipe} onChange={(e) => onChange({ ...work, recipe: e.target.value })}>
            {recipes.map((r) => <option key={r.recipe.name} value={r.recipe.name}>{r.recipe.name}</option>)}
          </select>
          <span className="field-hint">A factory run in its own worktree. Its pull request stage still waits for your click.</span>
        </label>
      ) : (
        <div className="field-row">
          <label className="field">
            <span>Kind</span>
            <select value={work.kind} onChange={(e) => onChange({ ...work, kind: e.target.value })}>
              {kinds.filter((k) => k.id !== 'freeform').map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Agent</span>
            <select value={work.agent ?? ''} onChange={(e) => onChange({ ...work, agent: e.target.value || undefined })}>
              <option value="">Default ({agents.find((a) => a.id === workspace.get().defaultAgent)?.name ?? 'Claude Code'})</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        </div>
      )}
    </>
  )
}

function PickupDialog({ root, onClose }: { root: string; onClose: () => void }): React.JSX.Element {
  const current = useBoardSettings(root)
  const [work, setWork] = useState<BoardWork>(current.work)
  const [parallel, setParallel] = useState(current.parallel)
  const save = (): void => {
    saveBoardSettings({ ...current, root, work, parallel })
    onClose()
  }
  return (
    <Modal
      title="Pick-up"
      size="sm"
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
        </>
      }
    >
      <div className="form board-form">
        <div className="field">
          <span>What starts for a card</span>
          <WorkFields work={work} onChange={setWork} />
        </div>
        <label className="field">
          <span>At a time</span>
          <select value={parallel} onChange={(e) => setParallel(Number(e.target.value))}>
            {[1, 2, 3, 4, 6].map((n) => <option key={n} value={n}>{n} card{n === 1 ? '' : 's'}</option>)}
          </select>
          <span className="field-hint">Auto pick-up starts the next Agent ready card (highest priority first) when one of these finishes. Only while the app is open, and nothing is pushed.</span>
        </label>
      </div>
    </Modal>
  )
}

function ItemDialog({ root, item, column, onClose }: { root: string; item?: BoardItem; column: BoardColumn; onClose: () => void }): React.JSX.Element {
  const [title, setTitle] = useState(item?.title ?? '')
  const [body, setBody] = useState(item?.body ?? '')
  const [labels, setLabels] = useState(item?.labels.join(', ') ?? '')
  const [priority, setPriority] = useState<BoardPriority>(item?.priority ?? 'normal')
  const [col, setCol] = useState<BoardColumn>(column)
  const [own, setOwn] = useState<BoardWork | undefined>(item?.work)
  const [after, setAfter] = useState(item?.blockedBy?.map((k) => `#${k}`).join(', ') ?? '')
  const titleRef = useRef<HTMLInputElement>(null)
  const settings = useBoardSettings(root)
  const all = board.get().items.filter((i) => i.root === root)
  const key = item?.key ?? Math.max(0, ...all.map((i) => i.key)) + 1
  const blockedBy = parseKeys(after).filter((k) => k !== key)
  const unknown = blockedBy.filter((k) => !all.some((i) => i.key === k))
  const loop = !unknown.length && wouldCycle(all, root, key, blockedBy)
  const afterError = unknown.length ? `No card ${unknown.map((k) => `#${k}`).join(', ')} on this board.` : loop ? 'That makes a loop: one of those cards already waits for this one.' : ''
  const save = (): void => {
    if (!title.trim() || afterError) return
    const fields = { title: title.trim(), body, labels: parseLabels(labels), priority, work: own, blockedBy }
    if (item) {
      updateItem(item.id, { ...fields, note: undefined })
      if (col !== item.column) moveTo(item.id, col)
    } else addItem(root, { ...fields, column: col })
    onClose()
  }
  return (
    <Modal
      title={item ? `#${item.key}` : 'New card'}
      size="md"
      onClose={onClose}
      onSubmit={save}
      initialFocus={titleRef}
      footerNote={item?.started ? 'Editing doesn’t change the run that’s already going.' : undefined}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!title.trim() || !!afterError}>{item ? 'Save' : 'Add card'}</button>
        </>
      }
    >
      <div className="form board-form">
        <label className="field">
          <span>Title</span>
          <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Rate-limit the public API" />
        </label>
        <label className="field">
          <span>Details</span>
          <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What done looks like, files to look at, how to check it. The agent gets all of it." />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Labels</span>
            <input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="bug, api" />
          </label>
          <label className="field">
            <span>Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value as BoardPriority)}>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label className="field">
            <span>Column</span>
            <select value={col} onChange={(e) => setCol(e.target.value as BoardColumn)}>
              {BOARD_COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Waits for</span>
          <input value={after} onChange={(e) => setAfter(e.target.value)} placeholder="Card numbers, e.g. #3, #7" aria-label="Waits for" />
          <span className={`field-hint${afterError ? ' evals-error' : ''}`}>{afterError || 'Pick-up starts this card only once those are Done.'}</span>
        </label>
        <div className="field">
          <span>Runs</span>
          <label className="check">
            <input type="checkbox" checked={!own} onChange={(e) => setOwn(e.target.checked ? undefined : settings.work)} /> The board’s pick-up setting ({workLabel(settings.work)})
          </label>
          {own && <WorkFields work={own} onChange={setOwn} />}
        </div>
      </div>
    </Modal>
  )
}
