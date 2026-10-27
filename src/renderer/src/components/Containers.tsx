import { useEffect, useMemo, useState } from 'react'
import type { DockerAction, DockerContainer, DockerList } from '@shared/types'
import { ChevronRight, Copy, ExternalLink, Play, RotateCw, ScrollText, Square, SquareTerminal, Trash2 } from 'lucide-react'
import { openTerminal } from '../dock/dockApi'
import { openSetup } from '../state/setup'
import { showContextMenu, type MenuItem } from './ContextMenu'
import { StatusDot } from './StatusDot'
import type { Signal } from '@shared/status'
import { confirmDelete } from '../lib/removals'

const errText = (e: unknown): string => String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')

// double quotes so the same command works in sh and in cmd.exe
const shellCommand = (c: DockerContainer): string => `docker exec -it ${c.id} /bin/sh -c "command -v bash >/dev/null && exec bash || exec sh"`
const logsCommand = (c: DockerContainer): string => `docker logs -f --tail 200 ${c.id}`

function containerSignal(state: string): Signal {
  if (state === 'running') return { tone: 'working', label: 'Running', pulse: false }
  if (state === 'restarting' || state === 'paused' || state === 'created') return { tone: 'attention', label: state, pulse: state === 'restarting' }
  if (state === 'dead') return { tone: 'error', label: 'Dead', pulse: false }
  return { tone: 'neutral', label: state, pulse: false }
}

export function Containers(): React.JSX.Element {
  const [data, setData] = useState<DockerList | null>(null)
  const [showStopped, setShowStopped] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  const refresh = async (): Promise<void> => setData(await window.api.docker.list())
  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 3000)
    return () => clearInterval(t)
  }, [])

  const act = async (c: DockerContainer, action: DockerAction): Promise<void> => {
    if (action === 'rm' && !(await confirmDelete('container', c.name, { note: `docker rm ${c.name}: its filesystem changes are lost; the image and named volumes stay.` }))) return
    setBusy(c.id)
    setError('')
    try {
      await window.api.docker.action(c.id, action)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(null)
      void refresh()
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, DockerContainer[]>()
    for (const c of data?.containers ?? []) {
      if (!showStopped && c.state !== 'running') continue
      const g = c.project ?? 'Standalone'
      map.set(g, [...(map.get(g) ?? []), c])
    }
    // compose projects first, standalone containers last
    return [...map.entries()].sort(([a], [b]) => (a === 'Standalone' ? 1 : b === 'Standalone' ? -1 : a.localeCompare(b)))
  }, [data, showStopped])

  if (data && !data.available) {
    return (
      <div className="view-scroll">
        <div className="empty-state">
          <p>{data.error}</p>
          <button className="btn" onClick={openSetup}>Open setup</button>
        </div>
      </div>
    )
  }

  const toggle = (g: string): void =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(g)) n.delete(g)
      else n.add(g)
      return n
    })

  return (
    <div className="view-scroll">
      <div className="view-footer row">
        <label className="check">
          <input type="checkbox" checked={showStopped} onChange={(e) => setShowStopped(e.target.checked)} />
          <span>Show stopped</span>
        </label>
      </div>
      {error && <div className="form-error pad">{error}</div>}
      {data === null && <div className="muted-note">Checking Docker…</div>}
      {data && !groups.length && <div className="muted-note">{data.containers.length ? 'No running containers.' : 'No containers yet. Start one with docker run or docker compose up.'}</div>}
      {groups.map(([group, list]) => (
        <div key={group} className="rt-group">
          <button className="rt-group-header" onClick={() => toggle(group)}>
            <ChevronRight size={13} className={`chev${collapsed.has(group) ? '' : ' open'}`} />
            <span>{group}</span>
            <span className="rt-source">{list.filter((c) => c.state === 'running').length}/{list.length} up</span>
          </button>
          {!collapsed.has(group) && list.map((c) => <ContainerRow key={c.id} c={c} busy={busy === c.id} act={(a) => void act(c, a)} />)}
        </div>
      ))}
    </div>
  )
}

function ContainerRow({ c, busy, act }: { c: DockerContainer; busy: boolean; act: (a: DockerAction) => void }): React.JSX.Element {
  const running = c.state === 'running'
  const title = c.service ?? c.name
  const shell = (): void => void openTerminal({ title, command: shellCommand(c), displayCommand: `docker exec -it ${c.name} bash || sh` })
  const logs = (): void => void openTerminal({ title: `logs ${title}`, command: logsCommand(c) })
  const menu = (): MenuItem[] => [
    { label: 'Open shell', icon: <SquareTerminal size={13} />, disabled: !running, run: shell },
    { label: 'Follow logs', icon: <ScrollText size={13} />, run: logs },
    ...c.hostPorts.map((p): MenuItem => ({ label: `Open localhost:${p}`, icon: <ExternalLink size={13} />, run: () => void window.api.shell.openExternal(`http://localhost:${p}`) })),
    { type: 'separator' },
    running ? { label: 'Stop', icon: <Square size={13} />, run: () => act('stop') } : { label: 'Start', icon: <Play size={13} />, run: () => act('start') },
    { label: 'Restart', icon: <RotateCw size={13} />, run: () => act('restart') },
    { label: 'Copy ID', icon: <Copy size={13} />, run: () => void navigator.clipboard.writeText(c.id) },
    { label: 'Remove…', icon: <Trash2 size={13} />, disabled: running, run: () => act('rm') }
  ]
  return (
    <div className="rt-row" data-container={c.name} onDoubleClick={() => (running ? shell() : logs())} onContextMenu={(e) => showContextMenu(e, menu())} title={`${c.name}\n${c.image}\n${c.status}${c.ports ? `\n${c.ports}` : ''}`}>
      <StatusDot signal={busy ? { tone: 'neutral', label: 'Working…', pulse: true } : containerSignal(c.state)} title={c.state} />
      <div className="rt-main">
        <div className="rt-name">{title}</div>
        <div className="rt-cmd">
          {c.image} · {c.status}
          {c.hostPorts.length > 0 && ` · :${c.hostPorts.join(', :')}`}
        </div>
      </div>
      <div className="row-actions">
        <button className="icon-btn" title="Follow logs" onClick={logs}>
          <ScrollText size={13} />
        </button>
        {running ? (
          <>
            <button className="icon-btn" title="Stop" disabled={busy} onClick={() => act('stop')}>
              <Square size={13} />
            </button>
            <button className="icon-btn go" title="Open shell" onClick={shell}>
              <SquareTerminal size={13} />
            </button>
          </>
        ) : (
          <button className="icon-btn go" title="Start" disabled={busy} onClick={() => act('start')}>
            <Play size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
