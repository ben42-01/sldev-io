import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, GitGraph, GitPullRequest, Tag } from 'lucide-react'
import { layoutGraph, prNumber, type GraphLog, type GraphRef, type GraphRow } from '@shared/gitGraph'
import { Empty, ErrorBanner, Loading } from '../components/States'
import { TimeAgo } from '../components/TimeAgo'
import { toast } from '../components/Toast'
import { openPanel } from './dockApi'

/** Every row is the same height, so only the rows in view (and a margin) are drawn: thousands stay smooth. */
const ROW_H = 26
const LANE_W = 12
/** lanes past this are clipped; histories that wide are unreadable anyway */
const MAX_LANES = 24
const OVERSCAN = 12
export const GRAPH_PAGE = 300

type Load = { root: string; state: 'loading' } | { root: string; state: 'error'; message: string } | { root: string; state: 'ready'; log: GraphLog }

export function openCommit(root: string, sha: string, subject: string): void {
  openPanel('commit', `commit-${sha}`, `${sha.slice(0, 7)} ${subject}`.slice(0, 48), { cwd: root, sha, subject })
}

/**
 * The commit graph of every branch, tag and remote: lanes drawn beside each row, refs as chips, PRs that merged
 * linked to GitHub. Pages of GRAPH_PAGE commits load as the list scrolls to its end.
 */
export function CommitGraph({ root, visible, githubUrl, reloadKey }: { root: string; visible: boolean; githubUrl: string | null; reloadKey: number }): React.JSX.Element {
  const [load, setLoad] = useState<Load | null>(null)
  const [limit, setLimit] = useState(GRAPH_PAGE)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const [selected, setSelected] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const latest = useRef(0)

  const read = useCallback(
    async (n: number): Promise<void> => {
      // only the latest read lands: a page asked for while a refresh is out must not be overwritten by it
      const id = ++latest.current
      setLoad((l) => (l?.root === root ? l : { root, state: 'loading' }))
      try {
        const log = await window.api.git.graphLog(root, n)
        if (id === latest.current) setLoad({ root, state: 'ready', log })
      } catch (e) {
        if (id === latest.current) setLoad({ root, state: 'error', message: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) })
      }
    },
    [root]
  )

  // a new folder starts again from the first page
  useEffect(() => {
    setLimit(GRAPH_PAGE)
    setSelected(null)
    box.current?.scrollTo({ top: 0 })
  }, [root])

  useEffect(() => {
    if (visible) void read(limit)
  }, [visible, limit, reloadKey, read])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [load?.state])

  const current = load?.root === root ? load : null
  const log = current?.state === 'ready' ? current.log : null
  const rows = useMemo(() => (log ? layoutGraph(log.commits) : []), [log])
  const lanes = useMemo(() => Math.min(MAX_LANES, rows.reduce((m, r) => Math.max(m, r.width), 1)), [rows])
  const prBase = githubUrl ?? log?.githubUrl ?? null

  // near the end of what is loaded, ask for the next page
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_H) + OVERSCAN)
  useEffect(() => {
    if (log?.more && last >= rows.length - OVERSCAN && limit <= rows.length) setLimit(rows.length + GRAPH_PAGE)
  }, [log?.more, last, rows.length, limit])

  if (!current || current.state === 'loading') return <Loading what="Reading the history…" />
  if (current.state === 'error') return <ErrorBanner onRetry={() => void read(limit)}>Couldn't read the history: {current.message}</ErrorBanner>
  if (!rows.length) return <Empty icon={<GitGraph size={20} />} title="No commits yet" hint="Commits on any branch show up here as a graph." />

  const onKey = (e: React.KeyboardEvent): void => {
    const i = rows.findIndex((r) => r.commit.sha === selected)
    const go = (n: number): void => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, n))]
      setSelected(r.commit.sha)
      const el = box.current
      const top = rows.indexOf(r) * ROW_H
      if (el && (top < el.scrollTop || top + ROW_H > el.scrollTop + el.clientHeight)) el.scrollTop = top - el.clientHeight / 2
    }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Enter' && i >= 0) openCommit(root, rows[i].commit.sha, rows[i].commit.subject)
    else return
    e.preventDefault()
  }

  return (
    <div className="cg" data-testid="commit-graph">
      <div className="cg-scroll" ref={box} tabIndex={0} role="listbox" aria-label="Commit graph" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} onKeyDown={onKey}>
        <div className="cg-inner" style={{ height: rows.length * ROW_H + (log?.more ? ROW_H : 0) }}>
          {rows.slice(first, last).map((r, k) => (
            <Row key={r.commit.sha} row={r} index={first + k} lanes={lanes} prBase={prBase} root={root} selected={selected === r.commit.sha} onSelect={setSelected} />
          ))}
          {log?.more && (
            <div className="cg-more muted small" style={{ top: rows.length * ROW_H }}>
              Loading more…
            </div>
          )}
        </div>
      </div>
      <div className="cg-foot muted small">
        {rows.length} commit{rows.length === 1 ? '' : 's'}
        {log?.more ? ', more load as you scroll' : ', all of them'} · click a commit for its diff
      </div>
    </div>
  )
}

const x = (c: number): number => c * LANE_W + LANE_W / 2
const MID = ROW_H / 2

const Row = memo(function Row(p: { row: GraphRow; index: number; lanes: number; prBase: string | null; root: string; selected: boolean; onSelect: (sha: string) => void }): React.JSX.Element {
  const { commit, col, color, through, into, out } = p.row
  const pr = prNumber(commit.subject)
  const merge = commit.parents.length > 1
  const w = p.lanes * LANE_W
  const copy = (e: React.MouseEvent): void => {
    e.stopPropagation()
    void navigator.clipboard.writeText(commit.sha).then(() => toast(`Copied ${commit.sha.slice(0, 7)}`))
  }
  return (
    <div
      className={`cg-row${p.selected ? ' on' : ''}${merge ? ' merge' : ''}`}
      style={{ top: p.index * ROW_H, height: ROW_H }}
      role="option"
      aria-selected={p.selected}
      data-sha={commit.sha}
      title={`${commit.sha}\n${commit.subject}`}
      onClick={() => {
        p.onSelect(commit.sha)
        openCommit(p.root, commit.sha, commit.subject)
      }}
    >
      <svg className="cg-lanes" width={w} height={ROW_H} viewBox={`0 0 ${w} ${ROW_H}`} aria-hidden="true">
        {through.map((t) => (
          <line key={`t${t.col}`} className={`cg-l${t.color}`} x1={x(t.col)} y1={0} x2={x(t.col)} y2={ROW_H} />
        ))}
        {into.map((t) => (
          <path key={`i${t.from}`} className={`cg-l${t.color}`} d={t.from === col ? `M${x(col)} 0V${MID}` : `M${x(t.from)} 0C${x(t.from)} ${MID * 0.7} ${x(col)} ${MID * 0.3} ${x(col)} ${MID}`} />
        ))}
        {out.map((o) => (
          <path key={`o${o.to}`} className={`cg-l${o.color}`} d={o.to === col ? `M${x(col)} ${MID}V${ROW_H}` : `M${x(col)} ${MID}C${x(col)} ${MID * 1.7} ${x(o.to)} ${MID * 1.3} ${x(o.to)} ${ROW_H}`} />
        ))}
        <circle className={`cg-node cg-n${color}${merge ? ' merge' : ''}`} cx={x(col)} cy={MID} r={merge ? 3.5 : 4} />
      </svg>
      <button className="cg-sha mono" title={`Copy ${commit.sha}`} aria-label={`Copy the commit hash ${commit.sha}`} onClick={copy}>
        {commit.sha.slice(0, 7)}
        <Copy size={10} />
      </button>
      {commit.refs.map((r) => (
        <RefChip key={`${r.kind}:${r.name}`} r={r} />
      ))}
      <span className={`cg-subject${merge ? ' muted' : ''}`}>{commit.subject}</span>
      {pr !== null &&
        (p.prBase ? (
          <button
            className="cg-pr"
            title={`Open pull request #${pr} on GitHub`}
            onClick={(e) => {
              e.stopPropagation()
              void window.api.shell.openExternal(`${p.prBase}/pull/${pr}`)
            }}
          >
            <GitPullRequest size={11} />#{pr}
          </button>
        ) : (
          <span className="cg-pr" title="Pull request (origin isn't on GitHub)">
            <GitPullRequest size={11} />#{pr}
          </span>
        ))}
      <span className="cg-author">{commit.author}</span>
      {commit.time > 0 && <TimeAgo t={commit.time} className="cg-time" />}
    </div>
  )
})

function RefChip({ r }: { r: GraphRef }): React.JSX.Element {
  const label = r.kind === 'head' ? (r.name === 'HEAD' ? 'HEAD (detached)' : r.name) : r.name
  const what = { head: 'Checked out (HEAD)', branch: 'Local branch', remote: 'Remote branch', tag: 'Tag' }[r.kind]
  return (
    <span className={`cg-ref ${r.kind}`} title={`${what}: ${r.name}`}>
      {r.kind === 'tag' && <Tag size={9} />}
      {label}
    </span>
  )
}
