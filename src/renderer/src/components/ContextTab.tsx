import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Brain, ChevronRight, ExternalLink, FilePlus2, Map as MapIcon, MoreHorizontal, PinOff, RefreshCw, Trash2 } from 'lucide-react'
import type { ContextHit, ContextKind, ContextStats } from '@shared/context'
import { BUILTIN_KINDS, renderKind } from '@shared/missionKinds'
import { staleSignal } from '@shared/status'
import { openInEditor } from '../lib/actions'
import { confirmDelete, errText } from '../lib/removals'
import { getAgent } from '../state/agents'
import { startMission } from '../state/missions'
import { showPicker } from '../state/picker'
import { useStore } from '../state/store'
import { updateSettings, workspace } from '../state/workspace'
import { showContextMenu, type MenuItem } from './ContextMenu'
import { Empty, ErrorBanner, Loading } from './States'
import { StatusPill } from './StatusDot'
import { ViewShell } from './RuntimesView'

const GROUPS: Array<{ kind: ContextKind; label: string; hint: string }> = [
  { kind: 'learning', label: 'Learnings', hint: '.sldev/memory.md' },
  { kind: 'doc', label: 'Docs', hint: '.sldev/context/' },
  { kind: 'file', label: 'Pinned files', hint: '.sldev/pinned.md' },
  { kind: 'skill', label: 'Skills', hint: 'project skills' }
]

const abs = (root: string, rel: string): string => {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root.replace(/[\\/]$/, '')}${sep}${rel.split('/').join(sep)}`
}

/** Starts a Map mission with the default agent: it writes .sldev/context, which later missions are pointed at. */
export async function mapProject(root: string): Promise<void> {
  const kind = BUILTIN_KINDS.find((k) => k.id === 'map')!
  const title = 'Map this project'
  await startMission({ prompt: renderKind(kind, { title, brief: '' }), brief: '', title, root, options: { agent: workspace.get().defaultAgent }, worktree: false, kind: { id: kind.id, name: kind.name, readOnly: false } })
}

/** Pick a project file and pin it; returns its project-relative path. */
export function pickFileToPin(root: string, done: (rel: string) => void, fail: (e: unknown) => void): void {
  showPicker({
    placeholder: 'Pin a file to the project context…',
    hint: 'Agents are pointed at it when a mission is about it',
    items: window.api.fs.listFiles(root).then((files) =>
      files.map((rel) => ({ id: rel, label: rel.split('/').pop()!, detail: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', run: () => void window.api.context.pin(root, rel).then(done, fail) }))
    )
  })
}

/** The right sidebar's Context tab. */
export function ContextView(): React.JSX.Element {
  return (
    <ViewShell title="Project Context">
      <ContextTab />
    </ViewShell>
  )
}

/**
 * What agents in this project are told. Learnings, reference docs, pinned files and
 * skills, searchable the way a mission's brief is matched, with notes whose files changed flagged.
 */
export function ContextTab(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const closed = useStore(workspace, (w) => w.assetGroups)
  const [data, setData] = useState<{ nodes: ContextHit[]; stats: ContextStats } | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ContextHit[] | null>(null)

  const load = useCallback(() => {
    if (!root) return
    setError('')
    void window.api.context.list(root).then(setData, (e) => setError(errText(e)))
  }, [root])
  useEffect(() => {
    setData(null)
    load()
    // the sources are edited in the user's editor and by agents; pick changes up when they come back
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  useEffect(() => {
    if (!root || !query.trim()) return setHits(null)
    let live = true
    const t = setTimeout(() => void window.api.context.search(root, query, 10).then((h) => live && setHits(h), () => live && setHits([])), 250)
    return () => ((live = false), clearTimeout(t))
  }, [root, query, data])

  const act = (p: Promise<unknown>): void => void p.then(load, (e) => setError(errText(e)))
  const shownNodes = useMemo(() => (data?.nodes ?? []).filter((n) => n.kind !== 'file' || n.line === 0), [data])

  if (!root) return <Empty icon={<Brain size={20} />} title="No project open" hint="Open a folder to see what agents know about it." />

  const map = (): void => act(mapProject(root))
  const pin = (): void => pickFileToPin(root, load, (e) => setError(errText(e)))
  const more = (e: React.MouseEvent): void =>
    showContextMenu(e, [
      { label: 'Open memory.md', icon: <BookOpen size={13} />, run: () => act(window.api.memory.ensure(root).then((p) => openInEditor(p))) },
      { label: 'Add the Map skill to this project', icon: <MapIcon size={13} />, run: () => act(window.api.context.installMapSkill(root).then((p) => openInEditor(p))) },
      { type: 'separator' },
      { label: 'Rebuild the index', icon: <RefreshCw size={13} />, run: () => act(window.api.context.rebuild(root)) }
    ])

  const toggle = (kind: ContextKind, open: boolean): void => updateSettings({ assetGroups: { ...workspace.get().assetGroups, [`context:${kind}`]: !open } })
  const empty = data && !shownNodes.length

  return (
    <div className="view-scroll context-tab">
      <div className="rules-actions">
        <button className="btn sm primary" onClick={map} title={`Start a Map mission with ${getAgent(workspace.get().defaultAgent).name}: it writes .sldev/context`}>
          <MapIcon size={13} /> Map this project
        </button>
        <button className="btn sm" onClick={pin}>
          <FilePlus2 size={13} /> Pin a file
        </button>
        <button className="icon-btn" title="More" aria-label="More context actions" onClick={more}>
          <MoreHorizontal size={13} />
        </button>
      </div>
      {error && <ErrorBanner onRetry={load}>{error}</ErrorBanner>}
      {!data && !error && <Loading what="Reading the project context…" />}
      {empty && (
        <Empty
          icon={<Brain size={20} />}
          title="No project context yet"
          hint={
            <>
              Missions are pointed at what earlier agents learned (<code>.sldev/memory.md</code>), reference docs in <code>.sldev/context/</code>, pinned files and project skills. Map
              the project to write the docs, or pin the files that matter.
            </>
          }
        />
      )}
      {data && !empty && (
        <>
          <div className="view-filter">
            <input placeholder="Search like a mission brief, or name a file" aria-label="Search the project context" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {hits ? (
            <div className="context-results">
              <div className="field-hint context-results-hint">{hits.length ? 'A mission with this brief is pointed at the first six.' : 'Nothing matches: a mission with this brief gets no notes.'}</div>
              {hits.map((n) => (
                <ContextRow key={n.id} n={n} root={root} act={act} showKind />
              ))}
            </div>
          ) : (
            GROUPS.map((g) => {
              const nodes = shownNodes.filter((n) => n.kind === g.kind)
              if (!nodes.length) return null
              const open = closed[`context:${g.kind}`] ?? true
              const stale = nodes.filter((n) => n.stale).length
              return (
                <div key={g.kind} className="rt-group asset-group" data-group={g.kind}>
                  <button className="rt-group-header" title={g.hint} onClick={() => toggle(g.kind, open)}>
                    <ChevronRight size={13} className={`chev${open ? ' open' : ''}`} />
                    <span>{g.label}</span>
                    {stale > 0 && <span className="context-stale-count" title={`${stale} may be out of date`}>{stale} to check</span>}
                    <span className="rt-source">{nodes.length}</span>
                  </button>
                  {open && nodes.map((n) => <ContextRow key={n.id} n={n} root={root} act={act} />)}
                </div>
              )
            })
          )}
          <div className="field-hint context-foot">Kept in the project as Markdown (commit it to share); sldev-io indexes it locally for search.</div>
        </>
      )}
    </div>
  )
}

function ContextRow({ n, root, act, showKind = false }: { n: ContextHit; root: string; act: (p: Promise<unknown>) => void; showKind?: boolean }): React.JSX.Element {
  const open = (): void => void openInEditor(abs(root, n.source))
  const forget = async (): Promise<void> => {
    if (await confirmDelete('learning', n.title, { note: 'The line is removed from .sldev/memory.md. Later missions are no longer pointed at it.' })) act(window.api.memory.forget(root, n.line, n.title))
  }
  const unpin = (): void => act(window.api.context.unpin(root, n.source))
  const menu = (): MenuItem[] => [
    { label: 'Open', icon: <ExternalLink size={13} />, run: open },
    ...n.paths.slice(0, 6).map((p): MenuItem => ({ label: `Open ${p}`, run: () => void openInEditor(abs(root, p)) })),
    ...(n.kind === 'learning' ? [{ type: 'separator' } as MenuItem, { label: 'Forget…', icon: <Trash2 size={13} />, run: () => void forget() }] : []),
    ...(n.kind === 'file' && n.line === 0 ? [{ type: 'separator' } as MenuItem, { label: 'Unpin', icon: <PinOff size={13} />, run: unpin }] : [])
  ]
  const where = `${n.source}${n.line > 1 ? `:${n.line}` : ''}`
  const meta = [showKind ? GROUPS.find((g) => g.kind === n.kind)?.label.replace(/s$/, '') : '', n.kind === 'learning' ? n.day : where, n.origin].filter(Boolean).join(' · ')
  return (
    <div className={`rt-row context-row${n.stale ? ' stale' : ''}`} onDoubleClick={open} onContextMenu={(e) => showContextMenu(e, menu())} title={n.body.slice(0, 400)}>
      <div className="rt-main">
        <div className="context-title">{n.title}</div>
        <div className="asset-desc">{meta}</div>
        {(n.stale || n.paths.length > 0) && (
          <div className="context-paths">
            {n.stale && <StatusPill signal={staleSignal(n.stale)} />}
            {n.paths
              .filter((p) => p !== n.stale?.path && p !== n.source)
              .slice(0, 3)
              .map((p) => (
                <span key={p} className="chip" title={p}>
                  {p}
                </span>
              ))}
          </div>
        )}
      </div>
      <div className="row-actions">
        <button className="icon-btn" title="Open" aria-label="Open" onClick={open}>
          <ExternalLink size={13} />
        </button>
        {n.kind === 'learning' && (
          <button className="icon-btn" title="Forget" aria-label="Forget this learning" onClick={() => void forget()}>
            <Trash2 size={13} />
          </button>
        )}
        {n.kind === 'file' && n.line === 0 && (
          <button className="icon-btn" title="Unpin" aria-label="Unpin this file" onClick={unpin}>
            <PinOff size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
