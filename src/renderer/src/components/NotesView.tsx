import { useEffect, useState } from 'react'
import type { NoteMeta } from '@shared/types'
import { FolderOpen, Plus, Rocket, SendHorizontal, Trash2 } from 'lucide-react'
import { activeTerminalId, openPanel } from '../dock/dockApi'
import { focusTerminal, writeToTerminal } from '../lib/terminals'
import { basename } from '../lib/paths'
import { startMission } from '../state/missions'
import { bumpNotes, notesVersion } from '../state/notes'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { showContextMenu } from './ContextMenu'
import { ago } from './MissionCard'
import { ViewShell } from './RuntimesView'

export function openNote(n: { path: string; title: string }): void {
  openPanel('note', `note:${n.path}`, n.title, { path: n.path })
}

export async function sendNoteToTerminal(path: string): Promise<boolean> {
  const id = activeTerminalId()
  if (!id) return false
  const text = (await window.api.notes.read(path)).replace(/^#.*\n+/, '').trim()
  // bracketed paste so multi-line text lands as one input in shells and agent CLIs
  writeToTerminal(id, `\x1b[200~${text}\x1b[201~`)
  focusTerminal(id)
  return true
}

export async function missionFromNote(path: string, title: string): Promise<void> {
  const root = workspace.get().rootFolder
  if (!root) return
  const prompt = (await window.api.notes.read(path)).replace(/^#.*\n+/, '').trim()
  if (prompt) await startMission({ prompt, title, root, options: { agent: workspace.get().defaultAgent }, worktree: false })
}

export function NotesView(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const version = useStore(notesVersion, (s) => s.v)
  const [project, setProject] = useState<NoteMeta[]>([])
  const [global, setGlobal] = useState<NoteMeta[]>([])
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState<null | 'project' | 'global'>(null)
  const [title, setTitle] = useState('')

  useEffect(() => {
    void window.api.notes.list(null).then(setGlobal)
    if (root) void window.api.notes.list(root).then(setProject)
    else setProject([])
  }, [root, version])

  const create = async (): Promise<void> => {
    const scope = creating === 'project' ? root : null
    const path = await window.api.notes.create(scope, title.trim() || 'Untitled')
    setCreating(null)
    setTitle('')
    bumpNotes()
    openNote({ path, title: title.trim() || 'Untitled' })
  }

  const f = filter.toLowerCase()
  const section = (label: string, list: NoteMeta[], scope: 'project' | 'global'): React.JSX.Element => (
    <>
      <div className="section-label pad row-label">
        <span>{label}</span>
        <button className="icon-btn" title="New note" onClick={() => setCreating(scope)}><Plus size={13} /></button>
        <button className="icon-btn" title="Open notes folder" onClick={() => void window.api.notes.openFolder(scope === 'project' ? root : null)}><FolderOpen size={13} /></button>
      </div>
      {creating === scope && (
        <form className="note-new" onSubmit={(e) => (e.preventDefault(), void create())}>
          <input autoFocus placeholder="Note title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setCreating(null)} onBlur={() => !title && setCreating(null)} />
        </form>
      )}
      {list.filter((n) => !f || n.title.toLowerCase().includes(f)).map((n) => (
        <div
          key={n.path}
          className="rt-row note-row"
          onClick={() => openNote(n)}
          onContextMenu={(e) =>
            showContextMenu(e, [
              { label: 'Open', run: () => openNote(n) },
              { label: 'Paste into active terminal', icon: <SendHorizontal size={13} />, run: () => void sendNoteToTerminal(n.path) },
              { label: 'Start mission from note', icon: <Rocket size={13} />, disabled: !root, run: () => void missionFromNote(n.path, n.title) },
              { type: 'separator' },
              { label: 'Delete (to trash)', icon: <Trash2 size={13} />, run: () => void window.api.notes.remove(n.path).then(bumpNotes) }
            ])
          }
        >
          <div className="rt-main">
            <div className="rt-name">{n.title}</div>
            <div className="rt-meta">{ago(n.mtime)}</div>
          </div>
        </div>
      ))}
      {!list.length && creating !== scope && <div className="muted-note">No notes yet.</div>}
    </>
  )

  return (
    <ViewShell
      title="Notes"
      actions={
        <button className="icon-btn" title="New note" onClick={() => setCreating(root ? 'project' : 'global')}>
          <Plus size={14} />
        </button>
      }
    >
      <div className="view-filter">
        <input placeholder="Filter notes" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="view-scroll">
        {root && section(basename(root), project, 'project')}
        {section('Global', global, 'global')}
      </div>
    </ViewShell>
  )
}
