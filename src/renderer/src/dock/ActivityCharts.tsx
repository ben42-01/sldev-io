import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { GitPullRequest } from 'lucide-react'
import type { RepoActivity } from '@shared/types'
import { ACTIVITY_RANGES, bucketCommits, bucketPrs, niceMax, type ActivityDays, type BucketUnit } from '@shared/gitStats'
import { ErrorBanner, Loading } from '../components/States'

type Load = { key: string; state: 'loading' } | { key: string; state: 'error'; message: string } | { key: string; state: 'ready'; data: RepoActivity; at: number }

const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`

/**
 * Commits per day (merges highlighted) and pull requests opened vs merged, over 7, 30 or 90 days. Reads when it
 * is shown, when the range changes and on the panel's Refresh (`reload`), never in the background.
 */
export function ActivityCharts({ root, visible, reload }: { root: string; visible: boolean; reload: number }): React.JSX.Element {
  const [days, setDays] = useState<ActivityDays>(30)
  const [load, setLoad] = useState<Load | null>(null)
  const key = `${root}\n${days}`
  const latest = useRef(key)
  latest.current = key

  const read = useCallback(async (): Promise<void> => {
    setLoad((l) => (l?.key === key ? l : { key, state: 'loading' }))
    try {
      const data = await window.api.gh.activity(root, days)
      if (latest.current === key) setLoad({ key, state: 'ready', data, at: Date.now() })
    } catch (e) {
      if (latest.current === key) setLoad({ key, state: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }, [root, days, key])

  useEffect(() => {
    if (visible) void read()
  }, [visible, read, reload])

  const current = load?.key === key ? load : null
  const now = current?.state === 'ready' ? current.at : 0
  const commits = useMemo(() => (current?.state === 'ready' && current.data.commits.value ? bucketCommits(current.data.commits.value, days, now) : null), [current, days, now])
  const prs = useMemo(() => (current?.state === 'ready' && current.data.prs.value ? bucketPrs(current.data.prs.value, days, now) : null), [current, days, now])

  return (
    <section className="ghs-activity" data-testid="ghs-activity">
      <div className="ghs-activity-head">
        <h3>Activity</h3>
        <div className="seg sm" role="group" aria-label="Range">
          {ACTIVITY_RANGES.map((d) => (
            <button key={d} className={days === d ? 'on' : ''} aria-pressed={days === d} data-days={d} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
      </div>

      {!current || current.state === 'loading' ? (
        <Loading what="Reading the history…" />
      ) : current.state === 'error' ? (
        <ErrorBanner onRetry={() => void read()}>Couldn't read the activity: {current.message}</ErrorBanner>
      ) : (
        <div className="ghs-cards">
          <section className="dash-card ghs-card" data-testid="ghs-commits-chart">
            <div className="dash-card-head">
              <h3>Commits</h3>
              {commits && (
                <span className="ghs-muted" data-testid="ghs-commits-total">
                  {plural(commits.total, 'commit')} · {plural(commits.merges, 'merge')} · {plural(commits.authors.length, 'author')}
                </span>
              )}
              <Legend items={[['commit', 'Commits'], ['merge', 'Merges']]} />
            </div>
            {current.data.commits.error ? (
              <div className="ghs-muted">Couldn't read git log: {current.data.commits.error}</div>
            ) : commits && (
              <>
                <BarChart
                  unit={commits.unit}
                  label={`Commits per ${commits.unit}, last ${days} days`}
                  mode="stack"
                  buckets={commits.buckets.map((b) => ({ key: b.key, label: b.label, values: [b.commits - b.merges, b.merges], readout: `${plural(b.commits, 'commit')}${b.merges ? `, ${plural(b.merges, 'merge')}` : ''}` }))}
                  series={['commit', 'merge']}
                />
                {commits.authors.length > 0 && (
                  <div className="ghs-authors ghs-muted" title={commits.authors.map((a) => `${a.name}: ${a.commits}`).join('\n')}>
                    Most commits: {commits.authors.slice(0, 3).map((a) => `${a.name} (${a.commits})`).join(', ')}
                    {commits.authors.length > 3 ? `, and ${plural(commits.authors.length - 3, 'other')}` : ''}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="dash-card ghs-card" data-testid="ghs-prs-chart">
            <div className="dash-card-head">
              <h3>Pull requests</h3>
              {prs && (
                <span className="ghs-muted" data-testid="ghs-prs-total">
                  {prs.opened} opened · {prs.merged} merged{prs.closed ? ` · ${prs.closed} closed unmerged` : ''}
                </span>
              )}
              {prs && <Legend items={[['opened', 'Opened'], ['merged', 'Merged']]} />}
            </div>
            {current.data.prs.error || !prs ? (
              <div className="ghs-note" data-testid="ghs-prs-note">
                <GitPullRequest size={13} />
                <span>Pull requests are read through the GitHub CLI, which isn't available here: {current.data.prs.error ?? 'no answer'}</span>
              </div>
            ) : (
              <BarChart
                unit={prs.unit}
                label={`Pull requests opened and merged per ${prs.unit}, last ${days} days`}
                mode="group"
                buckets={prs.buckets.map((b) => ({ key: b.key, label: b.label, values: [b.opened, b.merged], readout: `${b.opened} opened, ${b.merged} merged` }))}
                series={['opened', 'merged']}
              />
            )}
          </section>
        </div>
      )}
    </section>
  )
}

function Legend({ items }: { items: Array<[string, string]> }): React.JSX.Element {
  return (
    <span className="dash-legend ghs-legend">
      {items.map(([cls, label]) => (
        <span key={cls}>
          <i className={`ghs-sw ${cls}`} /> {label}
        </span>
      ))}
    </span>
  )
}

interface Bar {
  key: string
  label: string
  values: number[]
  readout: string
}

const H = 132
const AXIS = 18 // room for the day labels under the bars
const LEFT = 26 // room for the y labels

/** Plain SVG bars: stacked (bottom series first) or grouped side by side; hover a column for its numbers. */
function BarChart({ buckets, series, mode, unit, label }: { buckets: Bar[]; series: string[]; mode: 'stack' | 'group'; unit: BucketUnit; label: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 20) setWidth(el.clientWidth)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const peak = Math.max(0, ...buckets.map((b) => (mode === 'stack' ? b.values.reduce((s, v) => s + v, 0) : Math.max(...b.values))))
  const max = niceMax(peak)
  const plotH = H - AXIS
  const slot = (width - LEFT) / Math.max(1, buckets.length)
  const y = (v: number): number => plotH - (v / max) * (plotH - 6)
  // label the first, middle and last columns only; every one would collide at 30 days
  const labelled = new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])
  const shown = hover !== null ? buckets[hover] : null
  const total = buckets.reduce((s, b) => s + b.values.reduce((t, v) => t + v, 0), 0)

  return (
    <div className="ghs-chart" ref={host}>
      <div className="ghs-readout" aria-live="polite">
        {shown ? (
          <>
            <b>{shown.label}</b> {shown.readout}
          </>
        ) : total === 0 ? (
          `Nothing in this range`
        ) : (
          `Per ${unit}: hover a ${unit === 'day' ? 'day' : 'week'} for its numbers`
        )}
      </div>
      <svg width={width} height={H} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line className="ghs-grid" x1={LEFT} x2={width} y1={y(v)} y2={y(v)} />
            {(v === 0 || v === max || Number.isInteger(v)) && (
              <text className="ghs-tick" x={LEFT - 6} y={y(v) + 3.5} textAnchor="end">
                {v}
              </text>
            )}
          </g>
        ))}
        {buckets.map((b, i) => {
          const x0 = LEFT + i * slot
          const inner = Math.max(2, Math.min(slot - 2, mode === 'stack' ? 26 : 30))
          const bx = x0 + (slot - inner) / 2
          const marks: React.JSX.Element[] = []
          if (mode === 'stack') {
            let base = 0
            b.values.forEach((v, s) => {
              if (!v) return
              const top = y(base + v)
              // a 2px gap between stacked segments
              const bottom = y(base) - (base ? 2 : 0)
              const last = b.values.slice(s + 1).every((n) => !n)
              marks.push(<path key={s} className={`ghs-bar ${series[s]}`} d={barPath(bx, top, inner, bottom - top, last)} />)
              base += v
            })
          } else {
            const w = Math.max(1, (inner - 2) / b.values.length)
            b.values.forEach((v, s) => {
              if (!v) return
              marks.push(<path key={s} className={`ghs-bar ${series[s]}`} d={barPath(bx + s * (w + 2), y(v), w, plotH - y(v), true)} />)
            })
          }
          return (
            <g key={b.key} className={hover === i ? 'hover' : ''} data-key={b.key} data-values={b.values.join(',')}>
              {hover === i && <rect className="ghs-col" x={x0} y={0} width={slot} height={plotH} />}
              {marks}
              {labelled.has(i) && (
                <text className="ghs-tick" {...tickX(i, buckets.length, x0, slot)} y={H - 4}>
                  {b.label.replace('Week of ', '')}
                </text>
              )}
              <rect className="ghs-hit" x={x0} y={0} width={slot} height={plotH} onMouseEnter={() => setHover(i)}>
                <title>{`${b.label}: ${b.readout}`}</title>
              </rect>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Day labels: the first starts at its column, the last ends at its own, so neither runs off the chart. */
function tickX(i: number, n: number, x0: number, slot: number): { x: number; textAnchor: 'start' | 'middle' | 'end' } {
  if (n > 1 && i === 0) return { x: x0, textAnchor: 'start' }
  if (n > 1 && i === n - 1) return { x: x0 + slot, textAnchor: 'end' }
  return { x: x0 + slot / 2, textAnchor: 'middle' }
}

/** A bar with rounded top corners (when it is the top of its column), square at the baseline. */
function barPath(x: number, y: number, w: number, h: number, roundTop: boolean): string {
  if (h <= 0) return ''
  const r = roundTop ? Math.min(2, w / 2, h) : 0
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}
