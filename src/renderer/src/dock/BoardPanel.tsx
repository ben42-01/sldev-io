import { ChevronDown, CheckCheck, CircleDot, Plus, RefreshCw, Settings2, Sparkles, SquareKanban } from 'lucide-react'
import { BoardView, openBoardDialog } from '../components/BoardView'
import { showContextMenu, type MenuItem } from '../components/ContextMenu'
import { approve, refreshPrs, useBoardItems, useBoardSettings, useStoryJobs } from '../state/board'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { basename } from '../lib/paths'
import { openPanel } from './dockApi'

/** The work board in its own tab: agents write stories, you approve them, the factory picks them up. */
export function openBoard(then?: 'stories'): void {
  openPanel('board', 'board', 'Board')
  if (then === 'stories') setTimeout(() => openBoardDialog({ type: 'stories' }), 50)
}

export function BoardPanel(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const items = useBoardItems(root)
  const settings = useBoardSettings(root)
  const writing = useStoryJobs(root).filter((j) => !j.done).length
  const count = (c: string): number => items.filter((i) => i.column === c).length
  const proposed = items.filter((i) => i.column === 'proposed')
  const subtitle = [
    root ? basename(root) : 'No folder open',
    writing && `${writing} agent${writing === 1 ? '' : 's'} writing stories`,
    proposed.length && `${proposed.length} to approve`,
    count('ready') && `${count('ready')} agent ready`,
    count('progress') && `${count('progress')} in progress`,
    `pick-up ${settings.pickup ? 'on' : 'off'}`
  ]
    .filter(Boolean)
    .join(' · ')
  const menu = (): MenuItem[] => [
    { label: 'New card…', icon: <Plus size={13} />, run: () => openBoardDialog({ type: 'edit', column: 'backlog' }) },
    { label: 'Write stories with an agent…', icon: <Sparkles size={13} />, run: () => openBoardDialog({ type: 'stories' }) },
    { label: 'Import GitHub issues…', icon: <CircleDot size={13} />, run: () => openBoardDialog({ type: 'import' }) },
    { type: 'separator' },
    { label: `Approve all proposed${proposed.length ? ` (${proposed.length})` : ''}`, icon: <CheckCheck size={13} />, disabled: !proposed.length, run: () => approve(proposed.map((i) => i.id)) },
    { label: 'Check pull requests now', icon: <RefreshCw size={13} />, run: refreshPrs },
    { label: 'Pick-up settings…', icon: <Settings2 size={13} />, run: () => openBoardDialog({ type: 'pickup' }) }
  ]
  return (
    <div className="mc board-panel">
      <header className="mc-head">
        <div className="board-icon aurora"><SquareKanban size={17} /></div>
        <div className="board-title">
          <h2>Board</h2>
          <div className="muted small">{subtitle}</div>
        </div>
        <span className="grow" />
        <div className="board-head-actions">
          <button className="btn sm" disabled={!root} onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            showContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => e.preventDefault() }, menu())
          }} aria-haspopup="menu" title="Cards, stories, GitHub issues and pick-up">
            Board <ChevronDown size={12} />
          </button>
          <button className="btn sm primary" disabled={!root} onClick={() => openBoardDialog({ type: 'stories' })} title="An agent reads the code and splits a feature into well-defined stories">
            <Sparkles size={13} /> Write stories
          </button>
        </div>
      </header>
      <div className="mc-body">
        <BoardView root={root} />
      </div>
    </div>
  )
}
