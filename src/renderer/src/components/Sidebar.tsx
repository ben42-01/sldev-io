import { useRef } from 'react'
import { ChevronsDownUp, ExternalLink, FolderOpen, RefreshCw, SquareTerminal } from 'lucide-react'
import { openTerminal } from '../dock/dockApi'
import { openInEditor } from '../lib/actions'
import { basename, tildify } from '../lib/paths'
import { pickRootFolder, preferredEditor, setRootFolder, updateSettings, workspace } from '../state/workspace'
import { useStore } from '../state/store'
import { FileTree, type FileTreeHandle } from './FileTree'
import { RuntimesView } from './RuntimesView'
import { TasksView } from './TasksView'
import { MissionsView } from './MissionsView'
import { SkillsView } from './SkillsView'
import { WorkflowsView } from './WorkflowsView'
import { NotesView } from './NotesView'
import { RemoteView } from './RemoteView'

export function Sidebar({ home }: { home: string }): React.JSX.Element | null {
  const visible = useStore(workspace, (w) => w.sidebarVisible)
  const width = useStore(workspace, (w) => w.sidebarWidth)
  const view = useStore(workspace, (w) => w.activeView)
  if (!visible) return null
  return (
    <aside className="sidebar" style={{ width }}>
      {view === 'explorer' && <Explorer home={home} />}
      {view === 'runtimes' && <RuntimesView />}
      {view === 'agents' && <MissionsView />}
      {view === 'tasks' && <TasksView />}
      {view === 'skills' && <SkillsView />}
      {view === 'workflows' && <WorkflowsView />}
      {view === 'notes' && <NotesView />}
      {view === 'remote' && <RemoteView />}
      <ResizeHandle />
    </aside>
  )
}

function Explorer({ home }: { home: string }): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const recent = useStore(workspace, (w) => w.recentFolders)
  const tree = useRef<FileTreeHandle | null>(null)

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
        <span title={root}>{basename(root)}</span>
        <div className="sidebar-actions">
          <button className="icon-btn" title="New terminal at root" onClick={() => openTerminal({ cwd: root })}>
            <SquareTerminal size={14} />
          </button>
          <button className="icon-btn" title={`Open in ${preferredEditor()?.name ?? 'default app'}`} onClick={() => void openInEditor(root, preferredEditor(), true)}>
            <ExternalLink size={14} />
          </button>
          <button className="icon-btn" title="Refresh" onClick={() => tree.current?.refresh()}>
            <RefreshCw size={14} />
          </button>
          <button className="icon-btn" title="Collapse all" onClick={() => tree.current?.collapseAll()}>
            <ChevronsDownUp size={14} />
          </button>
          <button className="icon-btn" title="Open another folder" onClick={() => void pickRootFolder()}>
            <FolderOpen size={14} />
          </button>
        </div>
      </div>
      <FileTree root={root} handle={tree} />
    </div>
  )
}

function ResizeHandle(): React.JSX.Element {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const startX = e.clientX
    const startW = workspace.get().sidebarWidth
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    document.body.classList.add('resizing')
    const move = (ev: PointerEvent): void => workspace.set({ sidebarWidth: Math.min(640, Math.max(180, startW + ev.clientX - startX)) })
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
      updateSettings({ sidebarWidth: workspace.get().sidebarWidth })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return <div className="sidebar-resize" onPointerDown={onPointerDown} />
}
