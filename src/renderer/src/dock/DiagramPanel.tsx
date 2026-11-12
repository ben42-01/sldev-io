import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { Copy, Database, ExternalLink, FolderTree, KeyRound, Maximize, Network, RefreshCw, Search, Workflow } from 'lucide-react'
import { codeMermaid, languageSummary, layered, treeLayout, schemaMermaid, structureMermaid, type CodeGraph, type Placed, type SchemaGraph, type StructureGraph, type Table } from '@shared/diagram'
import { LANGS } from '@shared/diagramLangs'
import { openPanel } from './dockApi'
import { workspace } from '../state/workspace'
import { useStore } from '../state/store'
import { openFileAt, openInEditor } from '../lib/actions'
import { Empty, ErrorBanner, Loading } from '../components/States'
import { showNotice } from '../components/Modal'

type Tab = 'code' | 'files' | 'schema'

export function openDiagrams(tab: Tab = 'code'): void {
  if (!workspace.get().rootFolder) return void showNotice('No folder open', 'Open a project folder to draw its diagrams.')
  openPanel('diagram', 'diagrams', 'Diagrams', { tab, at: Date.now() })
}

function joinPath(root: string, rel: string): string {
  if (rel === '.' || !rel) return root
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${sep === '\\' ? rel.replace(/\//g, '\\') : rel}`
}

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: T }

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

const MAPPED = 'TypeScript/JavaScript, Python, Java, Kotlin, Scala, Go, C#, Rust, C/C++, Ruby and PHP'

/** Code map (folder imports in the mapped languages), Files (folders and files of any language) and schema ERD (Prisma, SQL), parsed locally by main. */
export function DiagramPanel({ params }: IDockviewPanelProps<{ tab?: Tab; at?: number }>): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const [tab, setTab] = useState<Tab>(params.tab ?? 'code')
  const [depth, setDepth] = useState(2)
  const [language, setLanguage] = useState('')
  const [query, setQuery] = useState('')
  const [nonce, setNonce] = useState(0)
  const [code, setCode] = useState<Load<CodeGraph>>({ state: 'loading' })
  const [files, setFiles] = useState<Load<StructureGraph>>({ state: 'loading' })
  const [schema, setSchema] = useState<Load<SchemaGraph>>({ state: 'loading' })
  // the languages of the last code scan, so the filter doesn't flicker while the next one loads
  const [languages, setLanguages] = useState<Record<string, number>>({})
  // switch to Files once when the code map has nothing to map, unless the user picked a tab
  const picked = useRef(false)
  const switched = useRef(false)
  const [autoHint, setAutoHint] = useState(false)
  const pick = (t: Tab): void => {
    picked.current = true
    setAutoHint(false)
    setTab(t)
  }

  useEffect(() => {
    if (params.tab) setTab(params.tab)
    picked.current = switched.current = false
  }, [params.tab, params.at])

  useEffect(() => {
    setLanguage('')
    setLanguages({})
    picked.current = switched.current = false
    setAutoHint(false)
  }, [root])

  useEffect(() => {
    if (!root || tab !== 'code') return
    let live = true
    setCode({ state: 'loading' })
    window.api.diagram.code(root, depth, language || undefined).then(
      (data) => {
        if (!live) return
        setCode({ state: 'ready', data })
        setLanguages(data.languages)
        if (data.scanned === 0 && !language && !picked.current && !switched.current) {
          switched.current = true
          setAutoHint(true)
          setTab('files')
        }
      },
      (e: unknown) => live && setCode({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    )
    return () => void (live = false)
  }, [root, tab, depth, language, nonce])

  useEffect(() => {
    if (!root || tab !== 'files') return
    let live = true
    setFiles({ state: 'loading' })
    window.api.diagram.structure(root, depth).then(
      (data) => live && setFiles({ state: 'ready', data }),
      (e: unknown) => live && setFiles({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    )
    return () => void (live = false)
  }, [root, tab, depth, nonce])

  useEffect(() => {
    if (!root || tab !== 'schema') return
    let live = true
    setSchema({ state: 'loading' })
    window.api.diagram.schema(root).then(
      (data) => live && setSchema({ state: 'ready', data }),
      (e: unknown) => live && setSchema({ state: 'error', message: e instanceof Error ? e.message : String(e) })
    )
    return () => void (live = false)
  }, [root, tab, nonce])

  const current = tab === 'code' ? code : tab === 'files' ? files : schema
  const langCount = Object.keys(languages).length
  const subtitle =
    current.state !== 'ready'
      ? 'Parsed locally from your source'
      : tab === 'code' && code.state === 'ready'
        ? `${code.data.nodes.length} folders · ${code.data.edges.length} links · ${code.data.scanned} files${code.data.truncated ? ' (first 4000)' : ''}${langCount ? ` · ${languageSummary(languages, 5)}` : ''}`
        : tab === 'files' && files.state === 'ready'
          ? `${files.data.nodes.filter((n) => n.kind === 'dir').length} folders · ${files.data.files} source files${files.data.files ? ` · ${languageSummary(files.data.languages, 5)}` : ''}${files.data.leavesHidden ? ' · files hidden (too many to draw)' : ''}`
          : schema.state === 'ready'
            ? `${schema.data.tables.length} tables · ${schema.data.relations.length} relations · ${schema.data.sources.length} file${schema.data.sources.length === 1 ? '' : 's'}`
            : ''

  const copyMermaid = (): void => {
    const text =
      tab === 'code'
        ? code.state === 'ready' ? codeMermaid(code.data) : ''
        : tab === 'files'
          ? files.state === 'ready' ? structureMermaid(files.data, baseName(root ?? '')) : ''
          : schema.state === 'ready' ? schemaMermaid(schema.data) : ''
    if (text) void navigator.clipboard.writeText(text).then(() => showNotice('Copied as Mermaid', 'Paste it into a pull request, an issue or a Markdown doc to render the diagram.'))
  }

  if (!root) return <div className="panel-page"><Empty big icon={<Network size={22} />} title="No folder open" hint="Open a project folder to draw its import graph and database schema." /></div>

  return (
    <div className="panel-page diagram-page">
      <header className="board-head">
        <div className="board-icon aurora">{tab === 'code' ? <Workflow size={17} /> : tab === 'files' ? <FolderTree size={17} /> : <Database size={17} />}</div>
        <div className="board-title">
          <h2>Diagrams</h2>
          <div className="muted small">{subtitle}</div>
        </div>
        <span className="grow" />
        <button className="btn sm" disabled={current.state !== 'ready'} onClick={copyMermaid} title="Copy the diagram as Mermaid text">
          <Copy size={13} /> Copy Mermaid
        </button>
        <button className="icon-btn" title="Scan again" aria-label="Scan again" onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw size={14} />
        </button>
      </header>

      <div className="board-filters">
        <div className="seg sm" role="group" aria-label="Diagram">
          <button type="button" className={tab === 'code' ? 'on' : ''} aria-pressed={tab === 'code'} onClick={() => pick('code')}><Workflow size={12} /> Code map</button>
          <button type="button" className={tab === 'files' ? 'on' : ''} aria-pressed={tab === 'files'} onClick={() => pick('files')}><FolderTree size={12} /> Files</button>
          <button type="button" className={tab === 'schema' ? 'on' : ''} aria-pressed={tab === 'schema'} onClick={() => pick('schema')}><Database size={12} /> Schema</button>
        </div>
        {tab !== 'schema' && (
          <div className="seg sm" role="group" aria-label="Folder depth" title="How many folder levels each box stands for">
            {[1, 2, 3, 4].map((d) => (
              <button key={d} type="button" className={depth === d ? 'on' : ''} aria-pressed={depth === d} onClick={() => setDepth(d)}>
                Depth {d}
              </button>
            ))}
          </div>
        )}
        {tab === 'code' && langCount > 1 && (
          <div className="seg sm" role="group" aria-label="Language" title="Map the imports of one language only">
            <button type="button" className={!language ? 'on' : ''} aria-pressed={!language} onClick={() => setLanguage('')}>All</button>
            {LANGS.filter((l) => languages[l.label]).map((l) => (
              <button key={l.id} type="button" className={language === l.id ? 'on' : ''} aria-pressed={language === l.id} onClick={() => setLanguage(l.id)}>
                {l.label} <span className="seg-count">{languages[l.label]}</span>
              </button>
            ))}
          </div>
        )}
        <label className="search-input">
          <Search size={12} />
          <input value={query} placeholder={tab === 'schema' ? 'Highlight tables or columns…' : tab === 'files' ? 'Highlight folders or files…' : 'Highlight folders…'} aria-label="Highlight" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      {autoHint && tab === 'files' && <div className="muted small diagram-hint">No imports to map in this project's languages; showing its files.</div>}

      {current.state === 'loading' ? (
        <Loading what={tab === 'code' ? 'imports' : tab === 'files' ? 'files' : 'schema files'} />
      ) : current.state === 'error' ? (
        <ErrorBanner onRetry={() => setNonce((n) => n + 1)}>Couldn't read the project: {current.message}</ErrorBanner>
      ) : tab === 'code' && code.state === 'ready' ? (
        code.data.nodes.length === 0 ? (
          <Empty
            big
            icon={<Workflow size={22} />}
            title="No imports to map"
            hint={`The code map reads imports in ${MAPPED}. Swift, Dart, Elixir and other languages are shown in Files.`}
            action={<button className="btn sm" onClick={() => pick('files')}><FolderTree size={13} /> Show files</button>}
          />
        ) : (
          <CodeMap graph={code.data} root={root} query={query} />
        )
      ) : tab === 'files' && files.state === 'ready' ? (
        files.data.nodes.length <= 1 ? (
          <Empty big icon={<FolderTree size={22} />} title="No source files found" hint="Files shows folders and source files in any language. Generated folders (node_modules, build output, virtualenvs) are left out." />
        ) : (
          <FilesMap graph={files.data} root={root} query={query} />
        )
      ) : schema.state === 'ready' ? (
        schema.data.tables.length === 0 ? (
          <Empty big icon={<Database size={22} />} title="No database schema found" hint="Looks for Prisma schemas (*.prisma) and SQL files with CREATE TABLE, such as migrations. Foreign keys become the lines between tables." />
        ) : (
          <SchemaMap graph={schema.data} root={root} query={query} />
        )
      ) : null}
    </div>
  )
}

// ── canvas: pan with drag, zoom with the wheel, fit on load ──

interface View {
  x: number
  y: number
  k: number
}

function bounds(placed: Placed[]): { x: number; y: number; w: number; h: number } {
  if (!placed.length) return { x: 0, y: 0, w: 1, h: 1 }
  const x = Math.min(...placed.map((p) => p.x))
  const y = Math.min(...placed.map((p) => p.y))
  return { x, y, w: Math.max(...placed.map((p) => p.x + p.w)) - x, h: Math.max(...placed.map((p) => p.y + p.h)) - y }
}

function Canvas({ placed, label, children, onBackground }: { placed: Placed[]; label: string; children: React.ReactNode; onBackground: () => void }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  // refit when the host resizes (side panel, dock split) until the user pans or zooms
  const touched = useRef(false)

  const fit = useCallback(() => {
    const el = host.current
    if (!el) return
    const b = bounds(placed)
    const pad = 32
    const k = Math.min(1.25, Math.max(0.15, Math.min((el.clientWidth - pad * 2) / b.w, (el.clientHeight - pad * 2) / b.h)))
    setView({ k, x: (el.clientWidth - b.w * k) / 2 - b.x * k, y: (el.clientHeight - b.h * k) / 2 - b.y * k })
  }, [placed])
  useEffect(() => {
    touched.current = false
    fit()
  }, [fit])
  useEffect(() => {
    const el = host.current
    if (!el) return
    let frame = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => !touched.current && el.clientWidth > 20 && fit())
    })
    ro.observe(el)
    return () => (ro.disconnect(), cancelAnimationFrame(frame))
  }, [fit])

  // wheel zoom around the pointer (non-passive, so the panel doesn't scroll)
  useEffect(() => {
    const el = host.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      touched.current = true
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      setView((v) => {
        const k = Math.min(3, Math.max(0.1, v.k * Math.exp(-e.deltaY * 0.0015)))
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div
      ref={host}
      className="diagram-canvas"
      onPointerDown={(e) => {
        if ((e.target as Element).closest('.dg-node')) return
        drag.current = { x: e.clientX, y: e.clientY, moved: false }
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = touched.current = true
        d.x = e.clientX
        d.y = e.clientY
        setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
      }}
      onPointerUp={() => {
        if (drag.current && !drag.current.moved) onBackground()
        drag.current = null
      }}
    >
      <svg role="img" aria-label={label} width="100%" height="100%">
        <defs>
          <marker id="dg-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" className="dg-arrowhead" />
          </marker>
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>{children}</g>
      </svg>
      <div className="diagram-zoom">
        <button className="icon-btn" title="Fit to view" aria-label="Fit to view" onClick={() => ((touched.current = false), fit())}><Maximize size={13} /></button>
        <span className="muted small">{Math.round(view.k * 100)}%</span>
      </div>
    </div>
  )
}

/** A curve from the right edge of `a` to the left edge of `b` (or back round, for a link pointing left). */
function link(a: Placed, b: Placed, ay = a.y + a.h / 2, by = b.y + b.h / 2): string {
  if (b.x > a.x + a.w) {
    const x1 = a.x + a.w
    const x2 = b.x
    const mid = (x2 - x1) / 2
    return `M${x1},${ay} C${x1 + mid},${ay} ${x2 - mid},${by} ${x2},${by}`
  }
  const x1 = a.x
  const x2 = b.x + b.w
  const bend = Math.max(40, (x1 - x2) / 2)
  return `M${x1},${ay} C${x1 - bend},${ay} ${x2 + bend},${by} ${x2},${by}`
}

// ── code map ──

function CodeMap({ graph, root, query }: { graph: CodeGraph; root: string; query: string }): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const placed = useMemo(
    () => layered(graph.nodes.map((n) => n.id), graph.edges, (id) => ({ w: Math.max(110, Math.min(260, id.length * 7 + 28)), h: 40 })),
    [graph]
  )
  const at = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed])
  const files = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n.files])), [graph])
  const q = query.trim().toLowerCase()
  const near = useMemo(() => {
    if (!selected) return null
    const s = new Set([selected])
    for (const e of graph.edges) if (e.from === selected || e.to === selected) s.add(e.from === selected ? e.to : e.from)
    return s
  }, [selected, graph])
  const dim = (id: string): boolean => (near ? !near.has(id) : !!q && !id.toLowerCase().includes(q))
  const sel = selected ? graph.nodes.find((n) => n.id === selected) : undefined
  const uses = sel ? graph.edges.filter((e) => e.from === sel.id) : []
  const usedBy = sel ? graph.edges.filter((e) => e.to === sel.id) : []
  useEffect(() => setSelected(null), [graph])

  return (
    <div className="diagram-body">
      <Canvas placed={placed} label="Import graph between folders" onBackground={() => setSelected(null)}>
        {graph.edges.map((e) => {
          const a = at.get(e.from)
          const b = at.get(e.to)
          if (!a || !b) return null
          const on = selected && (e.from === selected || e.to === selected)
          const off = (near && !on) || (!near && q && dim(e.from) && dim(e.to))
          return (
            <path key={`${e.from}>${e.to}`} d={link(a, b)} className={`dg-edge${on ? ' on' : ''}${off ? ' off' : ''}`} strokeWidth={Math.min(4, 1 + Math.log2(e.count) * 0.6)} markerEnd="url(#dg-arrow)">
              <title>{`${e.from} → ${e.to}: ${e.count} import${e.count === 1 ? '' : 's'}`}</title>
            </path>
          )
        })}
        {placed.map((p) => (
          <g
            key={p.id}
            className={`dg-node${selected === p.id ? ' selected' : ''}${dim(p.id) ? ' off' : ''}${q && !dim(p.id) && !near ? ' hit' : ''}`}
            transform={`translate(${p.x},${p.y})`}
            role="button"
            tabIndex={0}
            aria-label={`${p.id}, ${files.get(p.id) ?? 0} files`}
            onClick={() => setSelected(selected === p.id ? null : p.id)}
            onDoubleClick={() => void openInEditor(joinPath(root, p.id), undefined, true)}
            onKeyDown={(e) => e.key === 'Enter' && setSelected(p.id)}
          >
            <title>{`${p.id}\nDouble-click to open in your editor`}</title>
            <rect width={p.w} height={p.h} rx={6} />
            <text x={12} y={17} className="dg-label">{truncate(p.id, Math.floor((p.w - 24) / 7))}</text>
            <text x={12} y={31} className="dg-sub">{files.get(p.id) ? `${files.get(p.id)} file${files.get(p.id) === 1 ? '' : 's'}` : 'imported only'}</text>
          </g>
        ))}
      </Canvas>
      {sel && (
        <aside className="diagram-side">
          <div className="dg-side-head">
            <strong title={sel.id}>{sel.id}</strong>
            <button className="icon-btn" title="Open in editor" aria-label="Open in editor" onClick={() => void openInEditor(joinPath(root, sel.id), undefined, true)}><ExternalLink size={13} /></button>
          </div>
          <div className="muted small">{sel.files} file{sel.files === 1 ? '' : 's'}</div>
          <Deps title="Imports from" list={uses.map((e) => [e.to, e.count])} onPick={setSelected} />
          <Deps title="Used by" list={usedBy.map((e) => [e.from, e.count])} onPick={setSelected} />
        </aside>
      )}
    </div>
  )
}

function Deps({ title, list, onPick }: { title: string; list: Array<[string, number]>; onPick: (id: string) => void }): React.JSX.Element {
  return (
    <section>
      <div className="label">{title}</div>
      {list.length === 0 ? (
        <div className="muted small">Nothing</div>
      ) : (
        list
          .sort((a, b) => b[1] - a[1])
          .map(([id, n]) => (
            <button key={id} className="dg-dep" onClick={() => onPick(id)} title={`${n} import${n === 1 ? '' : 's'}`}>
              <span>{id}</span>
              <span className="seg-count">{n}</span>
            </button>
          ))
      )}
    </section>
  )
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `…${s.slice(s.length - n + 1)}`
}

// ── files ──

function FilesMap({ graph, root, query }: { graph: StructureGraph; root: string; query: string }): React.JSX.Element {
  const rootName = baseName(root)
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])
  const label = (id: string): string => (id === '.' ? rootName : baseName(id))
  const sub = (id: string): string => {
    const n = byId.get(id)!
    return n.kind === 'file' ? Object.keys(n.languages)[0] ?? '' : `${n.files} · ${languageSummary(n.languages, 2)}`
  }
  const placed = useMemo(
    () => {
      // folders first, then files, like an explorer
      const kind = (id: string): number => (byId.get(id)!.kind === 'dir' ? 0 : 1)
      const edges = [...graph.edges].sort((a, b) => kind(a.to) - kind(b.to) || a.to.localeCompare(b.to))
      return treeLayout('.', edges, (id) => ({ w: Math.max(110, Math.min(280, Math.max(label(id).length * 7, sub(id).length * 6.2) + 28)), h: 40 }))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, byId, rootName]
  )
  const at = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed])
  const q = query.trim().toLowerCase()
  const dim = (id: string): boolean => !!q && !id.toLowerCase().includes(q)
  const open = (id: string): void => {
    const n = byId.get(id)!
    if (n.kind === 'file') void openFileAt(joinPath(root, id))
    else void openInEditor(joinPath(root, id), undefined, true)
  }

  return (
    <div className="diagram-body">
      <Canvas placed={placed} label="Project folders and source files" onBackground={() => undefined}>
        {graph.edges.map((e) => {
          const a = at.get(e.from)
          const b = at.get(e.to)
          if (!a || !b) return null
          return <path key={`${e.from}>${e.to}`} d={link(a, b)} className={`dg-edge${q && dim(e.to) ? ' off' : ''}`} />
        })}
        {placed.map((p) => {
          const n = byId.get(p.id)!
          return (
            <g
              key={p.id}
              className={`dg-node${n.kind === 'file' ? ' dg-file' : ''}${dim(p.id) ? ' off' : ''}${q && !dim(p.id) ? ' hit' : ''}`}
              transform={`translate(${p.x},${p.y})`}
              role="button"
              tabIndex={0}
              aria-label={`${p.id}, ${n.kind === 'file' ? 'file' : `${n.files} file${n.files === 1 ? '' : 's'}`}`}
              onClick={() => open(p.id)}
              onKeyDown={(e) => e.key === 'Enter' && open(p.id)}
            >
              <title>{`${p.id === '.' ? rootName : p.id}\n${n.kind === 'dir' ? `${languageSummary(n.languages, 8)}\n` : ''}Click to open in your editor`}</title>
              <rect width={p.w} height={p.h} rx={6} />
              <text x={12} y={17} className="dg-label">{truncate(label(p.id) + (n.kind === 'dir' ? '/' : ''), Math.floor((p.w - 24) / 7))}</text>
              <text x={12} y={31} className="dg-sub">{truncate(sub(p.id), Math.floor((p.w - 24) / 6.2))}</text>
            </g>
          )
        })}
      </Canvas>
    </div>
  )
}

// ── schema ERD ──

const ROW = 18
const HEAD = 30
const MAX_ROWS = 16
const TABLE_W = 230

function tableHeight(t: Table): number {
  return HEAD + Math.min(t.columns.length, MAX_ROWS) * ROW + (t.columns.length > MAX_ROWS ? ROW : 0) + 8
}

function SchemaMap({ graph, root, query }: { graph: SchemaGraph; root: string; query: string }): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const byName = useMemo(() => new Map(graph.tables.map((t) => [t.name, t])), [graph])
  const placed = useMemo(
    () => layered(graph.tables.map((t) => t.name), graph.relations, (id) => ({ w: TABLE_W, h: tableHeight(byName.get(id)!) }), { x: 90, y: 28 }),
    [graph, byName]
  )
  const at = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed])
  const q = query.trim().toLowerCase()
  const near = useMemo(() => {
    if (!selected) return null
    const s = new Set([selected])
    for (const r of graph.relations) if (r.from === selected || r.to === selected) s.add(r.from === selected ? r.to : r.from)
    return s
  }, [selected, graph])
  const matches = (t: Table): boolean => !q || t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q))
  const dim = (t: Table): boolean => (near ? !near.has(t.name) : !matches(t))
  useEffect(() => setSelected(null), [graph])

  // a foreign key leaves from its column's row, when that row is drawn
  const rowY = (t: Table, p: Placed, cols: string[]): number => {
    const i = t.columns.findIndex((c) => cols.includes(c.name))
    return i >= 0 && i < MAX_ROWS ? p.y + HEAD + i * ROW + ROW / 2 + 2 : p.y + HEAD / 2
  }

  return (
    <div className="diagram-body">
      <Canvas placed={placed} label="Database tables and their foreign keys" onBackground={() => setSelected(null)}>
        {graph.relations.map((r, i) => {
          const a = at.get(r.from)
          const b = at.get(r.to)
          if (!a || !b) return null
          const on = selected && (r.from === selected || r.to === selected)
          const self = r.from === r.to
          const ay = rowY(byName.get(r.from)!, a, r.fromColumns)
          const by = rowY(byName.get(r.to)!, b, r.toColumns.length ? r.toColumns : byName.get(r.to)!.columns.filter((c) => c.pk).map((c) => c.name))
          const d = self ? `M${a.x + a.w},${ay} C${a.x + a.w + 50},${ay} ${a.x + a.w + 50},${a.y + HEAD / 2} ${a.x + a.w},${a.y + HEAD / 2}` : link(a, b, ay, by)
          return (
            <path key={i} d={d} className={`dg-edge${on ? ' on' : ''}${near && !on ? ' off' : ''}`} markerEnd="url(#dg-arrow)">
              <title>{`${r.from}.${r.fromColumns.join(', ')} → ${r.to}${r.toColumns.length ? `.${r.toColumns.join(', ')}` : ''}`}</title>
            </path>
          )
        })}
        {placed.map((p) => {
          const t = byName.get(p.id)!
          return (
            <g
              key={p.id}
              className={`dg-node dg-table${selected === p.id ? ' selected' : ''}${dim(t) ? ' off' : ''}`}
              transform={`translate(${p.x},${p.y})`}
              role="button"
              tabIndex={0}
              aria-label={`Table ${t.name}, ${t.columns.length} columns`}
              onClick={() => setSelected(selected === p.id ? null : p.id)}
              onDoubleClick={() => void openFileAt(joinPath(root, t.file), t.line)}
              onKeyDown={(e) => e.key === 'Enter' && void openFileAt(joinPath(root, t.file), t.line)}
            >
              <title>{`${t.name} (${t.file}:${t.line})\nDouble-click to open the definition`}</title>
              <rect width={p.w} height={p.h} rx={8} />
              <line x1={0} x2={p.w} y1={HEAD - 4} y2={HEAD - 4} className="dg-rule" />
              <text x={12} y={19} className="dg-label">{truncate(t.name, 28)}</text>
              {t.columns.slice(0, MAX_ROWS).map((c, i) => {
                const y = HEAD + i * ROW + 13
                const hit = q && c.name.toLowerCase().includes(q)
                return (
                  <g key={c.name} className={hit ? 'dg-col hit' : 'dg-col'}>
                    {c.pk && <KeyRound x={10} y={y - 10} width={11} height={11} className="dg-pk" aria-label="primary key" />}
                    <text x={26} y={y} className="dg-col-name">{truncate(c.name, 18)}{c.nullable ? '?' : ''}</text>
                    <text x={p.w - 10} y={y} textAnchor="end" className="dg-sub">{truncate(c.type, 14)}</text>
                  </g>
                )
              })}
              {t.columns.length > MAX_ROWS && <text x={26} y={HEAD + MAX_ROWS * ROW + 13} className="dg-sub">+{t.columns.length - MAX_ROWS} more</text>}
            </g>
          )
        })}
      </Canvas>
    </div>
  )
}
