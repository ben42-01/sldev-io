import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DirEntry } from '@shared/types'
import { ChevronRight, Copy, ExternalLink, File, FileCode2, FileJson, FileText, Folder, FolderOpen, FolderInput, PanelTop, SquareTerminal, Columns2 } from 'lucide-react'
import { openTerminal } from '../dock/dockApi'
import { openInEditor } from '../lib/actions'
import { dirname, relative } from '../lib/paths'
import { PATH_MIME } from '../lib/terminals'
import { preferredEditor, setRootFolder, workspace } from '../state/workspace'
import { useStore } from '../state/store'
import { showContextMenu, type MenuItem } from './ContextMenu'

interface Row {
  entry: DirEntry
  depth: number
}

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|c|cc|cpp|h|hpp|cs|rb|php|swift|sh|bash|zsh|lua|vue|svelte|css|scss|html)$/i

function fileIcon(name: string): React.JSX.Element {
  if (/\.json$/i.test(name)) return <FileJson size={15} className="ic-json" />
  if (/\.(md|mdx|txt|rst)$/i.test(name)) return <FileText size={15} className="ic-text" />
  if (CODE_EXT.test(name)) return <FileCode2 size={15} className="ic-code" />
  return <File size={15} className="ic-file" />
}

export interface FileTreeHandle {
  collapseAll(): void
  refresh(): void
}

export function FileTree({ root, handle }: { root: string; handle?: React.RefObject<FileTreeHandle | null> }): React.JSX.Element {
  const [children, setChildren] = useState<Map<string, DirEntry[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([root]))
  const [selected, setSelected] = useState<string | null>(null)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const editors = useStore(workspace, (w) => w.editors)
  const container = useRef<HTMLDivElement>(null)

  const load = useCallback(async (dir: string) => {
    let entries: DirEntry[] = []
    try {
      entries = await window.api.fs.readDir(dir)
    } catch {
      // permission denied or deleted: show as empty
    }
    setChildren((m) => new Map(m).set(dir, entries))
  }, [])

  useEffect(() => {
    setChildren(new Map())
    setExpanded(new Set([root]))
    setSelected(null)
    void load(root)
  }, [root, load])

  // Watch exactly the expanded folders, diffing so watchers aren't churned on every toggle.
  const watched = useRef(new Set<string>())
  useEffect(() => {
    for (const d of expanded) if (!watched.current.has(d)) window.api.fs.watch(d)
    for (const d of watched.current) if (!expanded.has(d)) window.api.fs.unwatch(d)
    watched.current = new Set(expanded)
  }, [expanded])
  useEffect(
    () => () => {
      for (const d of watched.current) window.api.fs.unwatch(d)
      watched.current.clear()
    },
    []
  )
  useEffect(() => window.api.fs.onChanged((dir) => expandedRef.current.has(dir) && void load(dir)), [load])

  const toggle = (dir: string, force?: boolean): void => {
    const open = force ?? !expanded.has(dir)
    setExpanded((s) => {
      const n = new Set(s)
      if (open) n.add(dir)
      else n.delete(dir)
      return n
    })
    if (open) void load(dir)
  }

  if (handle) {
    handle.current = {
      collapseAll: () => setExpanded(new Set([root])),
      refresh: () => expandedRef.current.forEach((d) => void load(d))
    }
  }

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (dir: string, depth: number): void => {
      for (const entry of children.get(dir) ?? []) {
        out.push({ entry, depth })
        if (entry.isDir && expanded.has(entry.path)) walk(entry.path, depth + 1)
      }
    }
    walk(root, 0)
    return out
  }, [children, expanded, root])

  const activate = (e: DirEntry): void => {
    if (e.isDir) toggle(e.path)
    else void openInEditor(e.path)
  }

  const menuFor = (e: DirEntry): MenuItem[] => {
    const dir = e.isDir ? e.path : dirname(e.path)
    const pref = preferredEditor()
    const items: MenuItem[] = [
      { type: 'header', label: e.name },
      { label: 'New terminal here', icon: <SquareTerminal size={14} />, run: () => openTerminal({ cwd: dir }) },
      { label: 'Split terminal right here', icon: <Columns2 size={14} />, run: () => openTerminal({ cwd: dir, direction: 'right' }) },
      { label: 'Floating terminal here', icon: <PanelTop size={14} />, run: () => openTerminal({ cwd: dir, floating: true }) },
      { type: 'separator' }
    ]
    if (pref) items.push({ label: `Open in ${pref.name}`, icon: <ExternalLink size={14} />, shortcut: e.isDir ? '' : 'Dbl-click', run: () => void openInEditor(e.path, pref, e.isDir) })
    for (const ed of editors) {
      if (ed.id !== pref?.id) items.push({ label: `Open in ${ed.name}`, run: () => void openInEditor(e.path, ed, e.isDir) })
    }
    items.push(
      { label: e.isDir ? 'Open in file manager' : 'Open with default app', run: () => void window.api.shell.openPath(e.path) },
      { label: 'Reveal in file manager', run: () => void window.api.shell.reveal(e.path) },
      { type: 'separator' },
      { label: 'Copy path', icon: <Copy size={14} />, run: () => void navigator.clipboard.writeText(e.path) },
      { label: 'Copy relative path', run: () => void navigator.clipboard.writeText(relative(root, e.path)) }
    )
    if (e.isDir) {
      items.push({ type: 'separator' }, { label: 'Open as workspace root', icon: <FolderInput size={14} />, run: () => setRootFolder(e.path) })
    }
    return items
  }

  const onKeyDown = (ev: React.KeyboardEvent): void => {
    const i = rows.findIndex((r) => r.entry.path === selected)
    const cur = rows[i]?.entry
    const select = (r?: Row): void => {
      if (!r) return
      setSelected(r.entry.path)
      container.current?.querySelector(`[data-path="${CSS.escape(r.entry.path)}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    if (ev.key === 'ArrowDown') select(rows[Math.min(rows.length - 1, i + 1)])
    else if (ev.key === 'ArrowUp') select(rows[Math.max(0, i - 1)])
    else if (ev.key === 'ArrowRight' && cur?.isDir) toggle(cur.path, true)
    else if (ev.key === 'ArrowLeft' && cur) {
      if (cur.isDir && expanded.has(cur.path)) toggle(cur.path, false)
      else select(rows.find((r) => r.entry.path === dirname(cur.path)))
    } else if (ev.key === 'Enter' && cur) activate(cur)
    else return
    ev.preventDefault()
  }

  return (
    <div className="tree" ref={container} tabIndex={0} onKeyDown={onKeyDown} onContextMenu={(ev) => showContextMenu(ev, menuFor({ name: root, path: root, isDir: true, isSymlink: false }))}>
      {rows.map(({ entry, depth }) => {
        const open = entry.isDir && expanded.has(entry.path)
        const dim = entry.name.startsWith('.') || entry.name === 'node_modules'
        return (
          <div
            key={entry.path}
            data-path={entry.path}
            className={`tree-row${selected === entry.path ? ' selected' : ''}${dim ? ' dim' : ''}`}
            style={{ paddingLeft: 8 + depth * 12 }}
            draggable
            onDragStart={(ev) => {
              ev.dataTransfer.setData(PATH_MIME, JSON.stringify([entry.path]))
              ev.dataTransfer.setData('text/plain', entry.path)
              ev.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => {
              setSelected(entry.path)
              if (entry.isDir) toggle(entry.path)
            }}
            onDoubleClick={() => !entry.isDir && void openInEditor(entry.path)}
            onContextMenu={(ev) => {
              ev.stopPropagation()
              setSelected(entry.path)
              showContextMenu(ev, menuFor(entry))
            }}
            title={entry.path}
          >
            <span className={`tree-chevron${open ? ' open' : ''}`}>{entry.isDir && <ChevronRight size={14} />}</span>
            <span className="tree-icon">{entry.isDir ? open ? <FolderOpen size={15} className="ic-folder" /> : <Folder size={15} className="ic-folder" /> : fileIcon(entry.name)}</span>
            <span className={`tree-name${entry.isSymlink ? ' symlink' : ''}`}>{entry.name}</span>
            <span className="tree-actions">
              <button
                className="icon-btn"
                title="New terminal here"
                onClick={(ev) => {
                  ev.stopPropagation()
                  openTerminal({ cwd: entry.isDir ? entry.path : dirname(entry.path) })
                }}
              >
                <SquareTerminal size={13} />
              </button>
              <button
                className="icon-btn"
                title={`Open in ${preferredEditor()?.name ?? 'default app'}`}
                onClick={(ev) => {
                  ev.stopPropagation()
                  void openInEditor(entry.path, preferredEditor(), entry.isDir)
                }}
              >
                <ExternalLink size={13} />
              </button>
            </span>
          </div>
        )
      })}
    </div>
  )
}
