import { ChevronDown, CheckCheck, CircleDot, GitBranch, Plus, RefreshCw, Settings2, Sparkles, SquareKanban, Tag } from 'lucide-react'
import { BoardView, openBoardDialog } from '../components/BoardView'
import { showContextMenu, type MenuItem } from '../components/ContextMenu'
import { approve, refreshPrs, setBoardSync, syncBoardFiles, useBoardItems, useBoardSettings, useStoryJobs } from '../state/board'
import { confirmAction } from '../components/Modal'
import { unreleased } from '@shared/board'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { basename } from '../lib/paths'
import { openPanel } from './dockApi'

/** The work board in its own tab: agents write stories, you approve them, the factory picks them up. */
export function openBoard(then?: 'stories' | 'release'): void {
  openPanel('board', 'board', 'Board')
  if (then) setTimeout(() => openBoardDialog({ type: then }), 50)
}

async function shareFlow(root: string | null): Promise<void> {
  if (!root) return
  const ok = await confirmAction({
    title: 'Share the board through git?',
    message: 'The cards are kept in .sldev/board.json in your project. Commit it, and teammates who pull it see the same board; their changes come in when you pull. If the file is already there, it is merged with this board first.',
    keeps: ['Which runs and missions worked on a card: they stay on this machine', 'Committing and pushing: that stays yours, nothing is committed for you'],
    confirmLabel: 'Share the board'
  })
  if (ok) setBoardSync(root, true)
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
    `pick-up ${settings.pickup ? 'on' : 'off'}`,
    settings.sync && 'shared in git'
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
    { label: `Release notes from Done${unreleased(items).length ? ` (${unreleased(items).length})` : ''}…`, icon: <Tag size={13} />, run: () => openBoardDialog({ type: 'release' }) },
    { label: 'Pick-up settings…', icon: <Settings2 size={13} />, run: () => openBoardDialog({ type: 'pickup' }) },
    { type: 'separator' },
    settings.sync
      ? { label: 'Stop sharing the board through git', icon: <GitBranch size={13} />, run: () => root && setBoardSync(root, false) }
      : { label: 'Share the board through git…', icon: <GitBranch size={13} />, run: () => void shareFlow(root) },
    ...(settings.sync ? [{ label: 'Read .sldev/board.json now', icon: <RefreshCw size={13} />, run: syncBoardFiles }] : [])
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
