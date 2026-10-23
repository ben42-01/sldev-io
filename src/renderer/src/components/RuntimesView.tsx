import { useMemo, useState } from 'react'
import type { CustomRuntime, RuntimeDef, RuntimeSource } from '@shared/types'
import { ChevronRight, Pencil, Play, Plus, RefreshCw, RotateCw, Square, SquareTerminal, Trash2 } from 'lucide-react'
import { focusPanel } from '../dock/dockApi'
import { isActive, useRun } from '../state/runs'
import { customToDef, loadRuntimes, restartRuntime, runRuntime, runtimes, saveCustomRuntimes, stopRuntime } from '../state/runtimes'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { showContextMenu, type MenuItem } from './ContextMenu'
import { StatusDot } from './StatusDot'

const SOURCE_LABEL: Record<RuntimeSource, string> = {
  npm: 'scripts',
  make: 'make',
  just: 'just',
  cargo: 'cargo',
  python: 'python',
  compose: 'compose',
  go: 'go',
  deno: 'deno',
  custom: 'custom'
}

export function RuntimesView(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const detected = useStore(runtimes, (r) => r.detected)
  const custom = useStore(runtimes, (r) => r.custom)
  const loading = useStore(runtimes, (r) => r.loading)
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<CustomRuntime | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const groups = useMemo(() => {
    const all = [...(root ? custom.map((c) => customToDef(c, root)) : []), ...detected]
    const f = filter.toLowerCase()
    const map = new Map<string, RuntimeDef[]>()
    for (const d of all) {
      if (f && !`${d.name} ${d.command} ${d.group}`.toLowerCase().includes(f)) continue
      map.set(d.group, [...(map.get(d.group) ?? []), d])
    }
    return [...map]
  }, [detected, custom, root, filter])

  if (!root) return <ViewShell title="Runtimes"><div className="empty-state"><p>Open a folder to see its scripts and commands.</p></div></ViewShell>

  const deleteCustom = (id: string): void => void saveCustomRuntimes(custom.filter((c) => c.id !== id))

  return (
    <ViewShell
      title="Runtimes"
      actions={
        <>
          <button className="icon-btn" title="Add custom command" onClick={() => setEditing({ id: '', name: '', command: '', cwd: '' })}>
            <Plus size={14} />
          </button>
          <button className="icon-btn" title="Rescan project" onClick={() => void loadRuntimes(root)}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </>
      }
    >
      {editing && (
        <CustomRuntimeForm
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={(c) => {
            void saveCustomRuntimes(editing.id ? custom.map((x) => (x.id === c.id ? c : x)) : [...custom, { ...c, id: Date.now().toString(36) }])
            setEditing(null)
          }}
        />
      )}
      <div className="view-filter">
        <input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="view-scroll">
        {groups.map(([group, defs]) => {
          const isCollapsed = collapsed.has(group)
          return (
            <div key={group} className="rt-group">
              <button
                className="rt-group-header"
                onClick={() => setCollapsed((s) => {
                  const n = new Set(s)
                  if (n.has(group)) n.delete(group)
                  else n.add(group)
                  return n
                })}
              >
                <ChevronRight size={13} className={`chev${isCollapsed ? '' : ' open'}`} />
                <span>{group}</span>
                <span className="rt-source">{SOURCE_LABEL[defs[0].source]}</span>
              </button>
              {!isCollapsed &&
                defs.map((d) => (
                  <RuntimeRow
                    key={d.id}
                    def={d}
                    onEdit={d.source === 'custom' ? () => setEditing(custom.find((c) => `custom::${c.id}` === d.id) ?? null) : undefined}
                    onDelete={d.source === 'custom' ? () => deleteCustom(d.id.slice('custom::'.length)) : undefined}
                  />
                ))}
            </div>
          )
        })}
        {!loading && !groups.length && (
          <div className="empty-state">
            <p>{filter ? 'Nothing matches.' : 'No scripts found. Add a custom command with +.'}</p>
          </div>
        )}
      </div>
    </ViewShell>
  )
}

function RuntimeRow({ def, onEdit, onDelete }: { def: RuntimeDef; onEdit?: () => void; onDelete?: () => void }): React.JSX.Element {
  const run = useRun('runtimeId', def.id)
  const active = isActive(run)
  const menu = (): MenuItem[] => {
    const items: MenuItem[] = [
      { label: active ? 'Stop' : 'Run', icon: active ? <Square size={13} /> : <Play size={13} />, run: () => (active ? stopRuntime(def.id) : runRuntime(def)) },
      { label: 'Restart', icon: <RotateCw size={13} />, disabled: !run, run: () => restartRuntime(def.id) },
      { label: 'Show terminal', icon: <SquareTerminal size={13} />, disabled: !run, run: () => run && focusPanel(run.panelId) },
      { type: 'separator' },
      { label: 'Copy command', run: () => void navigator.clipboard.writeText(def.command) }
    ]
    if (onEdit) items.push({ label: 'Edit', icon: <Pencil size={13} />, run: onEdit })
    if (onDelete) items.push({ label: 'Delete', icon: <Trash2 size={13} />, run: onDelete })
    return items
  }
  return (
    <div className="rt-row" onDoubleClick={() => runRuntime(def)} onContextMenu={(e) => showContextMenu(e, menu())} title={def.detail ?? def.command}>
      <StatusDot run={run} />
      <div className="rt-main">
        <div className="rt-name">{def.name}</div>
        <div className="rt-cmd">{def.detail ?? def.command}</div>
        {active && !!run?.ports.length && (
          <div className="rt-ports">
            {run.ports.map((p) => (
              <button key={p} className="port-chip" title={`Open http://localhost:${p}`} onClick={() => void window.api.shell.openExternal(`http://localhost:${p}`)}>
                :{p}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="row-actions">
        {run && (
          <button className="icon-btn" title="Show terminal" onClick={() => focusPanel(run.panelId)}>
            <SquareTerminal size={13} />
          </button>
        )}
        {active && (
          <button className="icon-btn" title="Restart" onClick={() => restartRuntime(def.id)}>
            <RotateCw size={13} />
          </button>
        )}
        <button className={`icon-btn${active ? ' danger' : ' go'}`} title={active ? 'Stop' : 'Run'} onClick={() => (active ? stopRuntime(def.id) : runRuntime(def))}>
          {active ? <Square size={13} /> : <Play size={13} />}
        </button>
      </div>
    </div>
  )
}

function CustomRuntimeForm({ initial, onSave, onCancel }: { initial: CustomRuntime; onSave: (c: CustomRuntime) => void; onCancel: () => void }): React.JSX.Element {
  const [c, setC] = useState(initial)
  const valid = c.name.trim() && c.command.trim()
  return (
    <form
      className="form inline-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSave({ ...c, name: c.name.trim(), command: c.command.trim(), cwd: c.cwd.trim() })
      }}
    >
      <label className="field">
        <span>Name</span>
        <input autoFocus value={c.name} placeholder="Dev server" onChange={(e) => setC({ ...c, name: e.target.value })} />
      </label>
      <label className="field">
        <span>Command</span>
        <input className="mono" value={c.command} placeholder="npm run dev -- --port 4000" onChange={(e) => setC({ ...c, command: e.target.value })} />
      </label>
      <label className="field">
        <span>Folder (relative to project)</span>
        <input className="mono" value={c.cwd} placeholder="(project root)" onChange={(e) => setC({ ...c, cwd: e.target.value })} />
      </label>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!valid}>Save</button>
      </div>
    </form>
  )
}

export function ViewShell({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="sidebar-body">
      <div className="sidebar-header">
        <span>{title}</span>
        {actions && <div className="sidebar-actions">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
