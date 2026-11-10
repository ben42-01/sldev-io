import { useRef, useState } from 'react'
import { ChevronRight, ChevronsDownUp, ExternalLink, FolderOpen, Network, RefreshCw, SquareTerminal } from 'lucide-react'
import { openTerminal } from '../dock/dockApi'
import { openDiagrams } from '../dock/DiagramPanel'
import { openInEditor } from '../lib/actions'
import { basename, tildify } from '../lib/paths'
import { pickRootFolder, preferredEditor, setRootFolder, updateSettings, workspace } from '../state/workspace'
import { useStore } from '../state/store'
import { FileTree, type FileTreeHandle } from './FileTree'
import { RuntimesView } from './RuntimesView'
import { TasksView } from './TasksView'
import { NotesView } from './NotesView'
import { RemoteView } from './RemoteView'
import { FactoryView } from './FactoryView'

export function Sidebar({ home }: { home: string }): React.JSX.Element | null {
  const visible = useStore(workspace, (w) => w.sidebarVisible)
  const width = useStore(workspace, (w) => w.sidebarWidth)
  const view = useStore(workspace, (w) => w.activeView)
  if (!visible) return null
  return (
    <aside className="sidebar" style={{ width }}>
      {view === 'explorer' && <Explorer home={home} />}
      {view === 'runtimes' && <RuntimesView />}
      {view === 'factory' && <FactoryView />}
      {view === 'tasks' && <TasksView />}
      {view === 'notes' && <NotesView />}
      {view === 'remote' && <RemoteView />}
      <ResizeHandle />
    </aside>
  )
}

/** projects whose root folder is folded in the Explorer, while the app is open: switching back finds it as it was */
const foldedRoots = new Set<string>()

function Explorer({ home }: { home: string }): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const recent = useStore(workspace, (w) => w.recentFolders)
  const tree = useRef<FileTreeHandle | null>(null)
  const [, setFolds] = useState(0)
  const open = !root || !foldedRoots.has(root)
  const toggleRoot = (): void => {
    if (!root) return
    if (open) foldedRoots.add(root)
    else foldedRoots.delete(root)
    setFolds((n) => n + 1)
  }

  if (!root) {
    return (
      <div className="sidebar-body">
        <div className="sidebar-header">
          <span>Explorer</span>
        </div>
        <div className="empty-state">
          <p>No folder open.</p>
          <button className="btn primary" onClick={() => void pickRootFolder()}>
            <FolderOpen size={14} /> Open folder
          </button>
          {recent.length > 0 && (
            <div className="recent-list">
              <div className="section-label">Recent</div>
              {recent.map((f) => (
                <button key={f} className="recent-item" title={f} onClick={() => setRootFolder(f)}>
                  <span className="recent-name">{basename(f)}</span>
                  <span className="recent-path">{tildify(f, home)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="sidebar-body">
      <div className="sidebar-header">
        <button className="sidebar-root" title={`${root}\n${open ? 'Click to fold' : 'Click to unfold'}`} aria-label={`${open ? 'Fold' : 'Unfold'} ${basename(root)}`} aria-expanded={open} onClick={toggleRoot}>
          <span className={`tree-chevron${open ? ' open' : ''}`}>
            <ChevronRight size={14} />
          </span>
          <span className="sidebar-root-name">{basename(root)}</span>
        </button>
        <div className="sidebar-actions">
          <button className="icon-btn" title="New terminal at root" aria-label="New terminal at root" onClick={() => openTerminal({ cwd: root })}>
            <SquareTerminal size={14} />
          </button>
          <button className="icon-btn" title={`Open in ${preferredEditor()?.name ?? 'default app'}`} onClick={() => void openInEditor(root, preferredEditor(), true)}>
            <ExternalLink size={14} />
          </button>
          <button className="icon-btn" title="Diagrams: code map and database schema" aria-label="Diagrams" onClick={() => openDiagrams()}>
            <Network size={14} />
          </button>
          <button className="icon-btn" title="Refresh" aria-label="Refresh" onClick={() => tree.current?.refresh()}>
            <RefreshCw size={14} />
          </button>
          <button className="icon-btn" title="Collapse all" aria-label="Collapse all" onClick={() => tree.current?.collapseAll()}>
            <ChevronsDownUp size={14} />
          </button>
          <button className="icon-btn" title="Open another folder" aria-label="Open another folder" onClick={() => void pickRootFolder()}>
            <FolderOpen size={14} />
          </button>
        </div>
      </div>
      <FileTree root={root} handle={tree} open={open} />
    </div>
  )
}

export function ResizeHandle({ side = 'left' }: { side?: 'left' | 'right' }): React.JSX.Element {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const startX = e.clientX
    const key = side === 'left' ? 'sidebarWidth' : 'rightPanelWidth'
    const startW = workspace.get()[key]
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    document.body.classList.add('resizing')
    // the right sidebar grows as its left edge moves left
    const move = (ev: PointerEvent): void => workspace.set({ [key]: Math.min(640, Math.max(180, startW + (side === 'left' ? 1 : -1) * (ev.clientX - startX))) })
    // a drag can end without a pointerup on the handle (cancelled, window lost focus, handle unmounted);
    // any of those must still clear the body class, or the resize cursor sticks everywhere
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('lostpointercapture', up)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('blur', up)
      if (!document.body.classList.contains('resizing')) return
      document.body.classList.remove('resizing')
      updateSettings({ [key]: workspace.get()[key] })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('lostpointercapture', up)
    window.addEventListener('pointerup', up)
    window.addEventListener('blur', up)
  }
  return <div className={`sidebar-resize ${side}`} onPointerDown={onPointerDown} />
}
