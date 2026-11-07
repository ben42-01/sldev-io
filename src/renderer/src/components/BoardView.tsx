import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ArrowDown, Bot, Ellipsis, Factory, Play, Plus, Search, Settings2, SquareKanban, Trash2 } from 'lucide-react'
import { BOARD_COLUMNS, boardLabels, columnItems, matchesItem, parseLabels, type BoardColumn, type BoardItem, type BoardPriority, type BoardWork, type WorkState } from '@shared/board'
import { missionSignal, runSignal, type Signal } from '@shared/status'
import { openMissionDetails } from './MissionDetails'
import { Modal, confirmAction } from './Modal'
import { showContextMenu, type MenuItem } from './ContextMenu'
import { StatusDot } from './StatusDot'
import { Empty } from './States'
import { useAgents } from '../state/agents'
import { addItem, moveTo, removeItem, saveBoardSettings, startItem, updateItem, useBoardItems, useBoardSettings, workOf } from '../state/board'
import { factory, loadRecipes, openPipeline } from '../state/factory'
import { useKinds } from '../state/missionKinds'
import { missions } from '../state/missions'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'

/**
 * The work board: Backlog → Agent ready → In progress → Review → Done. With pick-up on, the factory
 * takes Agent ready cards on its own; every card shows the run or mission working on it.
 */
export function BoardView({ root }: { root: string | null }): React.JSX.Element {
  const items = useBoardItems(root)
  const settings = useBoardSettings(root)
  const [query, setQuery] = useState('')
  const [label, setLabel] = useState<string | null>(null)
  const [editing, setEditing] = useState<BoardItem | { column: BoardColumn } | null>(null)
  const [setup, setSetup] = useState(false)
  // re-render cards when their runs and missions change
  useStore(missions, (s) => s.list)
  useStore(factory, (s) => s.runs)
  useEffect(() => void loadRecipes(root), [root])
  const labels = useMemo(() => boardLabels(items), [items])
  const shown = items.filter((i) => matchesItem(i, query, label))

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
        <button className="btn sm" onClick={() => setSetup(true)} title="What starts for a card, and how many at once">
          <Settings2 size={13} /> <span className="board-work-summary">{workLabel(settings.work)} · {settings.parallel} at a time</span>
        </button>
        <button className="btn sm primary" onClick={() => setEditing({ column: 'backlog' })}>
          <Plus size={13} /> New card
        </button>
      </div>
      <div className="board-columns">
        {BOARD_COLUMNS.map((c) => (
          <Column key={c.id} column={c} items={columnItems(shown, c.id)} total={items.filter((i) => i.column === c.id).length} root={root} pickup={settings.pickup} onOpen={setEditing} />
        ))}
      </div>
      {editing && <ItemDialog root={root} item={'id' in editing ? editing : undefined} column={'id' in editing ? editing.column : editing.column} onClose={() => setEditing(null)} />}
      {setup && <PickupDialog root={root} onClose={() => setSetup(false)} />}
    </div>
  )
}

const DRAG = 'application/x-sldev-board'

function Column({ column, items, total, root, pickup, onOpen }: { column: (typeof BOARD_COLUMNS)[number]; items: BoardItem[]; total: number; root: string; pickup: boolean; onOpen: (i: BoardItem) => void }): React.JSX.Element {
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
      </h3>
      <div className="board-column-body">
        {items.map((i) => <Card key={i.id} item={i} onOpen={() => onOpen(i)} />)}
        {!items.length && !adding && <div className="mc-column-empty"><span className="muted small">{column.hint}</span></div>}
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
    return { signal: runSignal(w.run.status, waiting), text: `${w.run.recipe.name} · ${done}/${nodes.length} stages${waiting ? ' · waiting for you' : ''}`, open: () => openPipeline(w.run!.id) }
  }
  const m = w.mission!
  return { signal: missionSignal(m.status), text: `${m.kind?.name ?? 'Mission'} · ${missionSignal(m.status).label}`, open: () => openMissionDetails(m.id) }
}

function Card({ item: i, onOpen }: { item: BoardItem; onOpen: () => void }): React.JSX.Element {
  const work = workLine(i)
  const startable = (i.column === 'backlog' || i.column === 'ready') && !i.started
  const menu = (): MenuItem[] => [
    { label: 'Edit…', run: onOpen },
    ...(startable ? [{ label: 'Start now', icon: <Play size={13} />, run: () => void startItem(i.id) }] : []),
    ...(work?.open ? [{ label: i.started?.type === 'run' ? 'Open pipeline' : 'Open mission', run: work.open }] : []),
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
        {i.priority !== 'normal' && (
          <span className={`board-priority ${i.priority}`} title={`${i.priority === 'high' ? 'High' : 'Low'} priority`}>
            {i.priority === 'high' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
          </span>
        )}
        {i.work && <span className="board-own" title={`Runs ${workLabel(i.work)} instead of the board's setting`}>{i.work.type === 'recipe' ? <Factory size={11} /> : <Bot size={11} />}</span>}
        <span className="grow" />
        <button className="icon-btn" title="More" aria-label="More" onClick={(e) => showContextMenu(e, menu())}>
          <Ellipsis size={13} />
        </button>
      </div>
      <button type="button" className="board-title" onClick={onOpen} title="Edit">{i.title}</button>
      {i.labels.length > 0 && <div className="board-card-labels">{i.labels.map((l) => <span key={l} className="board-label static">{l}</span>)}</div>}
      {i.note && <div className={`board-note${i.column === 'backlog' ? ' error' : ''}`}>{i.note}</div>}
      {(work || startable) && (
        <div className="board-card-foot">
          {work ? (
            <button type="button" className="board-work" onClick={work.open} disabled={!work.open} title={work.open ? 'Open it' : undefined}>
              <StatusDot signal={work.signal} small />
              <span>{work.text}</span>
            </button>
          ) : <span className="grow" />}
          {startable && (
            <button className="btn sm" onClick={() => void startItem(i.id)} title="Start its run now">
              <Play size={12} /> Start
            </button>
          )}
        </div>
      )}
    </article>
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
  const titleRef = useRef<HTMLInputElement>(null)
  const settings = useBoardSettings(root)
  const save = (): void => {
    if (!title.trim()) return
    const fields = { title: title.trim(), body, labels: parseLabels(labels), priority, work: own }
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
          <button type="submit" className="btn primary" disabled={!title.trim()}>{item ? 'Save' : 'Add card'}</button>
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
