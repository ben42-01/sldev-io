import { Check, GitMerge, Play, RotateCcw, Sparkles } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

/**
 * The hero: a Lead mission playing out. A goal is typed, the Lead plans, tasks fly out to three agents
 * from different vendors, diffs come back, one is sent back after review, everything is merged and
 * the tests pass. Pick another goal to replay it. Everything is derived from the time since the goal
 * started, so it is deterministic; with reduced motion it shows the finished state.
 */

interface Task {
  title: string
  agent: string
  why?: string
  /** ms the agent works */
  dur: number
  diff: string
  /** the Lead's review sends it back once */
  back?: string
}

interface Goal {
  label: string
  goal: string
  branch: string
  tasks: [Task, Task, Task]
  tests: string
  files: number
}

const GOALS: Goal[] = [
  {
    label: 'Team invites',
    goal: 'Let owners invite people to a team by email',
    branch: 'feature/team-invites',
    tasks: [
      { title: 'Invites API', agent: 'Codex', why: 'best on your evals · 9/10', dur: 2100, diff: '+182 −12', back: 'no rate limit on /invite' },
      { title: 'Invite email + UI', agent: 'Claude Code', dur: 2900, diff: '+96 −4' },
      { title: 'Tests for invites', agent: 'Gemini CLI', dur: 2500, diff: '+140' }
    ],
    tests: '112 passed',
    files: 9
  },
  {
    label: 'Dark mode',
    goal: 'Add a dark mode that follows the system setting',
    branch: 'feature/dark-mode',
    tasks: [
      { title: 'Theme tokens', agent: 'Claude Code', why: 'best on your evals · 8/10', dur: 2300, diff: '+64 −31' },
      { title: 'Settings toggle', agent: 'Codex', dur: 1900, diff: '+48 −6', back: 'toggle ignores the system setting' },
      { title: 'Visual tests', agent: 'Gemini CLI', dur: 2800, diff: '+77' }
    ],
    tests: '86 passed',
    files: 7
  },
  {
    label: 'Rate limits',
    goal: 'Rate-limit the public API, 429 when over',
    branch: 'feature/rate-limits',
    tasks: [
      { title: 'Token bucket middleware', agent: 'Codex', why: 'best on your evals · 9/10', dur: 2000, diff: '+121 −3' },
      { title: '429 responses + headers', agent: 'Claude Code', dur: 2400, diff: '+58 −9', back: 'Retry-After header missing' },
      { title: 'Load test', agent: 'Gemini CLI', dur: 2900, diff: '+93' }
    ],
    tests: '131 passed',
    files: 8
  }
]

// the timeline, in ms from the moment a goal starts
const TYPE = 1300
const PLAN = TYPE + 200
const DELEGATE = PLAN + 1100
const FIX = 1300
const REVIEW_GAP = 350

type WorkerState = 'idle' | 'working' | 'done' | 'back' | 'fixing' | 'merged'

interface Frame {
  typed: string
  planned: number
  workers: Array<{ state: WorkerState; progress: number }>
  merging: number
  tested: boolean
  done: boolean
  phase: string
}

function timeline(g: Goal) {
  const starts = g.tasks.map(() => DELEGATE)
  const ends = g.tasks.map((t) => DELEGATE + t.dur)
  const backAt = g.tasks.map((t, i) => (t.back ? ends[i] + REVIEW_GAP : undefined))
  const fixedAt = g.tasks.map((_, i) => (backAt[i] !== undefined ? backAt[i]! + FIX : ends[i]))
  const allDone = Math.max(...fixedAt)
  const merge = allDone + 400
  const tested = merge + 3 * 300 + 500
  const done = tested + 500
  return { starts, ends, backAt, fixedAt, merge, tested, done }
}

function frameAt(g: Goal, ms: number): Frame {
  const tl = timeline(g)
  const typed = g.goal.slice(0, Math.max(0, Math.floor((ms / TYPE) * g.goal.length)))
  const planned = ms < PLAN ? 0 : Math.min(3, Math.floor((ms - PLAN) / 300) + 1)
  const merging = ms < tl.merge ? 0 : Math.min(3, Math.floor((ms - tl.merge) / 300) + 1)
  const workers = g.tasks.map((t, i) => {
    if (ms < tl.starts[i]) return { state: 'idle' as const, progress: 0 }
    if (merging > i) return { state: 'merged' as const, progress: 1 }
    if (ms < tl.ends[i]) return { state: 'working' as const, progress: (ms - tl.starts[i]) / t.dur }
    const back = tl.backAt[i]
    if (back !== undefined && ms >= back && ms < tl.fixedAt[i]) return { state: 'fixing' as const, progress: (ms - back) / FIX }
    if (back !== undefined && ms >= tl.ends[i] + 120 && ms < back) return { state: 'back' as const, progress: 1 }
    return { state: 'done' as const, progress: 1 }
  })
  const phase =
    ms < TYPE ? 'Reading the goal' :
    ms < DELEGATE ? 'Planning: 3 independent tasks' :
    ms < tl.merge ? (workers.some((w) => w.state === 'back' || w.state === 'fixing') ? 'Reviewing diffs against the criteria' : 'Delegating · 3 agents in parallel') :
    ms < tl.tested ? 'Merging branches' : 'Done · waiting for your review'
  return { typed, planned, workers, merging, tested: ms >= tl.tested, done: ms >= tl.done, phase }
}

const LABEL: Record<WorkerState, string> = { idle: 'Queued', working: 'Working', done: 'Done', back: 'Sent back', fixing: 'Fixing', merged: 'Merged' }

/** Wires between the cards, measured from the DOM so they follow the layout. */
function useWires(body: React.RefObject<HTMLDivElement | null>) {
  const [wires, setWires] = useState<{ out: string[]; back: string[]; w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    const measure = (): void => {
      const box = el.getBoundingClientRect()
      const lead = el.querySelector('.tg-lead')?.getBoundingClientRect()
      const merge = el.querySelector('.tg-merge')?.getBoundingClientRect()
      const workers = [...el.querySelectorAll('.tg-worker')].map((w) => w.getBoundingClientRect())
      // stacked on a phone: no wires
      if (!lead || !merge || workers.length !== 3 || lead.right > workers[0].left) return setWires(null)
      const at = (r: DOMRect, side: 'l' | 'r'): [number, number] => [(side === 'l' ? r.left : r.right) - box.left, r.top + r.height / 2 - box.top]
      const curve = ([x1, y1]: [number, number], [x2, y2]: [number, number]): string => {
        const dx = (x2 - x1) / 2
        return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
      }
      setWires({
        out: workers.map((w) => curve(at(lead, 'r'), at(w, 'l'))),
        back: workers.map((w) => curve(at(w, 'r'), at(merge, 'l'))),
        w: box.width,
        h: box.height
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [body])
  return wires
}

/** Runs while on screen, from 0 ms, restarting when the goal changes; frozen at the end with reduced motion. */
function useClock(key: number, end: number, onEnd: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const [ms, setMs] = useState(0)
  const [visible, setVisible] = useState(false)
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver !== 'function') return setVisible(true)
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => setMs(reduced ? end : 0), [key, reduced, end])
  useEffect(() => {
    if (!visible || reduced) return
    const t = setInterval(() => setMs((m) => m + 100), 100)
    return () => clearInterval(t)
  }, [visible, reduced, key])
  // a few seconds on the finished state, then the next goal
  useEffect(() => {
    if (!reduced && ms > end + 5200) onEnd()
  }, [ms, end, reduced, onEnd])
  return { ref, ms, reduced }
}

export function TeamGraph() {
  const [goal, setGoal] = useState(0)
  const [run, setRun] = useState(0)
  const g = GOALS[goal]
  const tl = timeline(g)
  const { ref, ms, reduced } = useClock(run, tl.done, () => {
    setGoal((n) => (n + 1) % GOALS.length)
    setRun((r) => r + 1)
  })
  const f = frameAt(g, ms)
  const body = useRef<HTMLDivElement>(null)
  const wires = useWires(body)
  const pick = (n: number): void => {
    setGoal(n)
    setRun((r) => r + 1)
  }

  return (
    <div className="tg brand-frame" ref={ref}>
      <div className="tg-bar">
        <span className="tg-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="tg-kind">Lead mission</span>
        <span className="tg-goal" aria-label={`Goal: ${g.goal}`}>
          <Sparkles size={13} />
          <span>{reduced ? g.goal : f.typed}</span>
          {!reduced && ms < TYPE + 400 && <span className="tg-caret" />}
        </span>
        <span className="tg-picks" role="group" aria-label="Try another goal">
          {GOALS.map((x, n) => (
            <button key={x.label} type="button" className={n === goal ? 'on' : undefined} aria-pressed={n === goal} onClick={() => pick(n)}>
              {x.label}
            </button>
          ))}
          <button type="button" className="tg-replay" title="Replay" aria-label="Replay" onClick={() => setRun((r) => r + 1)}>
            {f.done ? <RotateCcw size={13} /> : <Play size={13} />}
          </button>
        </span>
      </div>

      <div className="tg-body" ref={body}>
        {wires && (
          <svg className="tg-wires" width={wires.w} height={wires.h} aria-hidden="true">
            {wires.out.map((d, i) => <path key={`o${i}`} d={d} className={`tg-wire${f.workers[i].state !== 'idle' ? ' live' : ''}`} />)}
            {wires.back.map((d, i) => <path key={`b${i}`} d={d} className={`tg-wire${f.workers[i].state === 'merged' ? ' merged' : f.workers[i].state === 'done' ? ' live' : ''}`} />)}
          </svg>
        )}
        {wires && !reduced && (
          <div className="tg-packets" aria-hidden="true">
            {wires.out.map((d, i) => ms >= DELEGATE && ms < DELEGATE + 700 && <span key={`po${i}-${run}`} className="tg-packet" style={{ offsetPath: `path('${d}')`, animationDelay: `${i * 90}ms` } as CSSProperties} />)}
            {wires.out.map((d, i) => tl.backAt[i] !== undefined && ms >= tl.backAt[i]! - 300 && ms < tl.backAt[i]! + 400 && <span key={`pr${i}-${run}`} className="tg-packet amber reverse" style={{ offsetPath: `path('${d}')` } as CSSProperties} />)}
            {wires.back.map((d, i) => ms >= tl.merge - 500 + i * 300 && ms < tl.merge + 200 + i * 300 && <span key={`pb${i}-${run}`} className="tg-packet green" style={{ offsetPath: `path('${d}')` } as CSSProperties} />)}
          </div>
        )}

        <div className={`tg-card tg-lead${f.done ? ' finished' : ' live'}`}>
          <div className="tg-card-head">
            <span className={`tg-dot ${f.done ? 'done' : 'planning'}`} />
            <b>Lead</b>
            <span className="tg-who">Claude Code</span>
          </div>
          <div className="tg-phase">{f.phase}</div>
          <ol className="tg-plan">
            {g.tasks.map((t, i) => (
              <li key={t.title} className={i < f.planned ? 'in' : undefined}>
                <span className="tg-n">{i + 1}</span> {t.title}
              </li>
            ))}
          </ol>
        </div>

        <div className="tg-workers">
          {g.tasks.map((t, i) => {
            const w = f.workers[i]
            return (
              <div key={`${goal}-${i}`} className={`tg-card tg-worker ${w.state}`}>
                <div className="tg-card-head">
                  <span className={`tg-dot ${w.state}`} />
                  <b>{t.agent}</b>
                  <span className="tg-state">{LABEL[w.state]}</span>
                </div>
                <div className="tg-task">{t.title}</div>
                <div className="tg-meter"><span style={{ transform: `scaleX(${w.state === 'idle' ? 0 : Math.min(1, w.progress)})` }} /></div>
                <div className="tg-sub">
                  {w.state === 'back' || w.state === 'fixing' ? <span className="t-amber">Review: {t.back}</span> :
                    w.state === 'done' || w.state === 'merged' ? <span>{t.diff} · {w.state === 'merged' ? 'merged' : 'ready'}</span> :
                    t.why && w.state !== 'idle' ? <span className="tg-why">{t.why}</span> : <span>&nbsp;</span>}
                </div>
              </div>
            )
          })}
        </div>

        <div className={`tg-card tg-merge${f.done ? ' finished' : ''}`}>
          <div className="tg-card-head">
            <GitMerge size={13} />
            <b>{g.branch}</b>
          </div>
          <ul className="tg-merged">
            {g.tasks.map((t, i) => (
              <li key={t.title} className={i < f.merging ? 'in' : undefined}>
                <Check size={12} /> {t.title}
              </li>
            ))}
          </ul>
          <div className={`tg-tests${f.tested ? ' in' : ''}`}>
            <span className="t-dim">npm test</span> <span className="t-green">✓ {g.tests}</span>
          </div>
          <div className={`tg-ready${f.done ? ' in' : ''}`}>
            <span className="tg-review">Review {g.files} files</span>
            <span className="t-dim">nothing pushed</span>
          </div>
        </div>
      </div>
    </div>
  )
}
