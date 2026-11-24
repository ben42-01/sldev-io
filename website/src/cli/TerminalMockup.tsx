import { useEffect, useRef, useState } from 'react'

/**
 * The sldev TUI drawn in HTML: the brand and tab bar on top, the rule with the active tab underlined in the
 * brand gradient, the grouped sidebar with its status markers, a pane with an agent at work, and the key chips
 * on the status line. It follows cli/src/render.ts (layout, sidebar, tabBarLayout, ruleLine, hints) by eye,
 * not by import, so this site builds on its own. A short script plays on a loop: the agent works through its
 * task, another one asks for you, then the first is ready for review. With reduced motion it shows the end
 * state, still.
 */

type Tone = 'working' | 'attention' | 'review' | 'done' | 'neutral'

interface Pane {
  n: number
  title: string
  agent?: string
  /** a shell tab's folder */
  cwd?: string
  branch?: string
  project: string
  stat?: { ins: number; del: number }
  tone: Tone
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const STATE: Record<Tone, string> = { working: 'working', attention: 'needs you', review: 'ready', done: 'done', neutral: 'shell' }
const FOOT: Array<[Tone, string]> = [
  ['attention', 'need you'],
  ['working', 'working'],
  ['review', 'ready'],
  ['done', 'done']
]
const HINTS: Array<[string, string]> = [['c', 'new tab'], ['t', 'shell'], ['1-9', 'go to'], ['?', 'all keys'], ['d', 'detach'], ['b', 'briefs'], ['s', 'split'], ['w', 'workflows'], ['n/p', 'next/prev'], ['e', 'editor']]

type Line = { kind: 'prompt' | 'tool' | 'text' | 'ok' | 'blank'; text: string; extra?: string }

/** what the agent in tab 1 prints, one line per step */
const OUTPUT: Line[] = [
  { kind: 'prompt', text: 'Fix the flaky parser test in test/parser.test.ts' },
  { kind: 'blank', text: '' },
  { kind: 'tool', text: 'Read test/parser.test.ts' },
  { kind: 'tool', text: 'Read src/parser.ts' },
  { kind: 'text', text: 'The test reads the file before the watcher has flushed it.' },
  { kind: 'tool', text: 'Edit src/parser.ts', extra: '+12 -3' },
  { kind: 'tool', text: 'Bash npm test' },
  { kind: 'ok', text: '48 tests passed, 20 runs in a row' },
  { kind: 'blank', text: '' },
  { kind: 'text', text: 'Done: the parser waits for the flush, and the test is stable.' }
]
/** the step at which tab 2 starts waiting for you */
const ASKS_AT = 4
/** steps the end state stays on screen before the loop starts again */
const HOLD = 5
const LAST = OUTPUT.length

function panesAt(step: number): Pane[] {
  const done = step >= LAST
  return [
    { n: 1, title: 'fix the parser', agent: 'claude', branch: 'fix/parser', project: 'webshop', stat: step >= 6 ? { ins: 12, del: 3 } : undefined, tone: done ? 'review' : 'working' },
    { n: 2, title: 'review auth', agent: 'codex', branch: 'review/auth', project: 'webshop', tone: step >= ASKS_AT ? 'attention' : 'working' },
    { n: 3, title: 'shell', cwd: '~/code/webshop', project: 'webshop', tone: 'neutral' },
    { n: 4, title: 'docs pass', agent: 'gemini', branch: 'docs/api', project: 'api', stat: { ins: 86, del: 14 }, tone: 'done' }
  ]
}

function glyph(p: Pane, spin: number): string {
  if (p.tone === 'working') return SPINNER[spin % SPINNER.length]
  if (p.tone === 'done') return '✓'
  if (p.tone === 'neutral') return '›'
  return '●'
}

const URGENCY: Tone[] = ['attention', 'working', 'review', 'done', 'neutral']
const rollup = (list: Pane[]): Tone => URGENCY.find((t) => list.some((p) => p.tone === t)) ?? 'neutral'

function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const on = (): void => setReduced(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return reduced
}

/** animates only while the mockup is on screen */
function useOnScreen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [on, setOn] = useState(true)
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting))
    io.observe(ref.current)
    return () => io.disconnect()
  }, [])
  return [ref, on]
}

export function TerminalMockup({ version }: { version: string }) {
  const reduced = useReducedMotion()
  const [ref, onScreen] = useOnScreen<HTMLDivElement>()
  const [step, setStep] = useState(reduced ? LAST : 1)
  const [spin, setSpin] = useState(2)
  const animate = !reduced && onScreen

  useEffect(() => {
    if (reduced) setStep(LAST)
  }, [reduced])
  useEffect(() => {
    if (!animate) return
    const t = window.setInterval(() => setStep((s) => (s >= LAST + HOLD ? 1 : s + 1)), 950)
    return () => window.clearInterval(t)
  }, [animate])
  useEffect(() => {
    if (!animate) return
    const t = window.setInterval(() => setSpin((s) => s + 1), 90)
    return () => window.clearInterval(t)
  }, [animate])

  const shown = Math.min(step, LAST)
  const panes = panesAt(shown)
  const active = panes[0]
  const groups = [...new Set(panes.map((p) => p.project))].map((project) => ({ project, list: panes.filter((p) => p.project === project) }))
  const counts = FOOT.map(([t, label]) => ({ t, label, n: panes.filter((p) => p.agent && p.tone === t).length })).filter((c) => c.n)
  const details = ['#1', 'claude', STATE[active.tone], active.branch, active.stat ? `+${active.stat.ins} -${active.stat.del}` : ''].filter(Boolean).join(' · ')

  return (
    <div
      ref={ref}
      className={`tui${reduced ? ' still' : ''}`}
      role="img"
      aria-label="The sldev terminal UI: four tabs on top, a sidebar grouping them by project with a status marker each, an agent fixing a parser test in the main pane, and the keys along the bottom."
    >
      <div className="tui-grid" aria-hidden="true">
        {/* row 1: the brand over the sidebar, then the tabs */}
        <div className="tui-brand">
          <b className="brand-text">sldev</b> <span className="subtle">{version}</span>
        </div>
        <div className="tui-tabs">
          {panes.map((p, i) => (
            <span key={p.n} className={`tui-tab${i === 0 ? ' active' : ''}`}>
              <span className={`tone-${p.tone}${p.tone === 'attention' ? ' breathe' : ''}`}>{glyph(p, spin)}</span> {p.n} {p.title}
              {i === 0 && <span className="dim"> ×</span>}
            </span>
          ))}
          <span className="tui-plus accent">+</span>
        </div>

        {/* row 2: the gradient under the brand, the rule with the active tab underlined and the pane's details */}
        <div className="tui-brandline" />
        <div className="tui-rule">
          {/* under the active tab, its marker to its ×: ` ● 1 title × ` less a column each side */}
          <span className="tui-rule-heavy" style={{ width: `${active.title.length + 6}ch` }} />
          <span className="tui-rule-line" />
          <span className="tui-rule-info dim"> {details} </span>
          <span className="tui-rule-end" />
        </div>

        {/* the sidebar */}
        <div className="tui-side">
          <div className="tui-side-new">
            <span className="accent">+</span> New tab <span className="dim">^b c</span>
          </div>
          <div className="tui-side-body">
            {groups.map((g) => {
              const tone = rollup(g.list)
              return (
                <div key={g.project} className="tui-group">
                  <div className="tui-group-head">
                    <b className="dim">{g.project.toUpperCase()}</b> <span className={`tone-${tone}`}>{tone === 'neutral' ? ' ' : '●'}</span>{' '}
                    <span className="dim">{g.list.length}</span>
                  </div>
                  {g.list
                    .slice()
                    .sort((a, b) => Number(!a.agent) - Number(!b.agent))
                    .map((p) => (
                      <div key={p.n} className={`tui-item${p === active ? ' focus' : ''}`}>
                        <div>
                          <span className="tui-bar">{p === active ? '▌' : ' '}</span>{' '}
                          <span className={`tone-${p.tone}${p.tone === 'attention' ? ' breathe' : ''}`}>{glyph(p, spin)}</span> <span className="dim">{p.n}</span>{' '}
                          {p === active ? <b>{p.title}</b> : p.title}
                        </div>
                        <div>
                          <span className="tui-bar">{p === active ? '▌' : ' '}</span>
                          {'   '}
                          <span className="dim">{p.agent ? [p.agent, STATE[p.tone], p.branch].join(' · ') : p.cwd}</span>
                          {p.stat && (
                            <>
                              {' '}
                              <span className="tone-working">+{p.stat.ins}</span> <span className="tone-error">-{p.stat.del}</span>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )
            })}
          </div>
          <div className="tui-side-foot">
            {counts.map((c) => (
              <span key={c.t}>
                <span className={`tone-${c.t}`}>●</span>
                <span className="dim">
                  {' '}
                  {c.n} {c.label}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* the pane: the agent's own output */}
        <div className="tui-pane">
          {OUTPUT.slice(0, shown).map((l, i) => (
            <div key={i} className={`tui-line ${l.kind}`}>
              {l.kind === 'prompt' && <span className="accent">› </span>}
              {l.kind === 'tool' && <span className="tone-working">● </span>}
              {l.kind === 'ok' && <span className="tone-working">  ✓ </span>}
              {l.kind === 'text' && '  '}
              {l.kind === 'tool' ? <b>{l.text}</b> : l.text}
              {l.extra && (
                <>
                  {'  '}
                  <span className="tone-working">{l.extra.split(' ')[0]}</span> <span className="tone-error">{l.extra.split(' ')[1]}</span>
                </>
              )}
            </div>
          ))}
          {shown < LAST && (
            <div className="tui-line">
              <span className="tone-working">{SPINNER[spin % SPINNER.length]}</span> <span className="dim">working…</span>
            </div>
          )}
        </div>

        {/* the status line: ^b and the keys as chips, the project and time on the right */}
        <div className="tui-status">
          <span className="tui-hints">
            <span className="accent tui-prefix">^b</span>
            {HINTS.map(([k, what]) => (
              <span key={k} className="tui-hint">
                <kbd>{k}</kbd>
                <span className="dim">{what}</span>
              </span>
            ))}
          </span>
          <span className="tui-right dim">webshop · 14:02</span>
        </div>
      </div>
    </div>
  )
}
