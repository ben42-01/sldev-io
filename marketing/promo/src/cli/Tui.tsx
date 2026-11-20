import type { CSSProperties, ReactNode } from 'react'
import { useCurrentFrame } from 'remotion'
import { BRAND, BRAND_D, C, MONO } from '../lib'
import { CLI as cli } from './data'

/**
 * The sldev TUI drawn for video: the brand and tab bar on top, the rule with the active tab underlined in the
 * brand gradient, the sidebar grouped by project with a status marker per pane, the pane, and the key chips
 * on the status line. It follows cli/src/render.ts and the website's mockup (website/src/cli/TerminalMockup.tsx)
 * by eye, a touch larger so it reads on a phone.
 */

export type Tone = 'working' | 'attention' | 'review' | 'done' | 'neutral' | 'error'

// the CLI's grey ladder and tones (website/src/cli/cli.css)
export const T = {
  bg: '#0a0a0a',
  surface: '#111111',
  raised: '#191919',
  muted: '#202020',
  rule: '#353535',
  fg: '#e8e8e8',
  dim: '#929292',
  subtle: '#636363'
}
export const TONE: Record<Tone, string> = { working: C.green, attention: C.amber, review: '#5b9dff', done: '#34d0d0', neutral: T.subtle, error: C.red }
const STATE: Record<Tone, string> = { working: 'working', attention: 'needs you', review: 'ready', done: 'done', neutral: 'shell', error: 'stopped' }

export interface Pane {
  n: number
  title: string
  agent?: string
  /** a shell tab's folder */
  cwd?: string
  branch?: string
  project: string
  stat?: { ins: number; del: number }
  tone: Tone
  /** the state word, when it says more than the tone (e.g. "usage limit") */
  state?: string
  /** drawn under its parent in the sidebar (a conductor's children) */
  child?: boolean
}

export const FONT = 20
export const ROW = 32
export const CH = FONT * 0.6

export function glyph(tone: Tone): string {
  if (tone === 'done') return '✓'
  if (tone === 'neutral') return '›'
  if (tone === 'error') return '✗'
  return '●'
}

/** what needs you breathes: bright, then soft, never a blink */
const breathe = (frame: number): number => 0.7 + 0.3 * Math.cos(frame / 7.6)

export function Mark({ tone, style }: { tone: Tone; style?: CSSProperties }) {
  const frame = useCurrentFrame()
  if (tone === 'working') {
    // the CLI spins a braille dot; the video's mono font has no braille, so it's drawn
    return (
      <span style={{ display: 'inline-flex', width: CH, height: ROW, alignItems: 'center', justifyContent: 'center', verticalAlign: 'top', ...style }}>
        <span style={{ width: CH * 0.95, height: CH * 0.95, borderRadius: 99, border: `2px solid ${TONE.working}`, borderTopColor: 'transparent', transform: `rotate(${frame * 14}deg)` }} />
      </span>
    )
  }
  return <span style={{ color: TONE[tone], fontWeight: tone === 'attention' ? 700 : 400, opacity: tone === 'attention' ? breathe(frame) : 1, ...style }}>{glyph(tone)}</span>
}

const URGENCY: Tone[] = ['attention', 'error', 'working', 'review', 'done', 'neutral']
const rollup = (list: Pane[]): Tone => URGENCY.find((t) => list.some((p) => p.tone === t)) ?? 'neutral'

const HINTS: Array<[string, string]> = [['c', 'new tab'], ['t', 'shell'], ['1-9', 'go to'], ['b', 'briefs'], ['s', 'split'], ['w', 'workflows'], ['v', 'changes'], ['e', 'editor'], ['?', 'keys'], ['d', 'detach']]
const FOOT: Array<[Tone, string]> = [['attention', 'need you'], ['working', 'working'], ['review', 'ready'], ['done', 'done']]

/** a line in a pane: plain text, or spans with their own colour */
export const Dim = ({ children }: { children: ReactNode }) => <span style={{ color: T.dim }}>{children}</span>
export const Bold = ({ children }: { children: ReactNode }) => <span style={{ fontWeight: 600, color: T.fg }}>{children}</span>

export function Tui({
  panes,
  active,
  children,
  width = 1640,
  height = 880,
  popup,
  clock = '14:02',
  /** a key flashing on the status line, e.g. "2" just after Ctrl-b 2 */
  pressed,
  style
}: {
  panes: Pane[]
  active: number
  children: ReactNode
  width?: number
  height?: number
  popup?: ReactNode
  clock?: string
  pressed?: string | null
  style?: CSSProperties
}) {
  const frame = useCurrentFrame()
  const on = panes.find((p) => p.n === active) ?? panes[0]
  const projects = [...new Set(panes.map((p) => p.project))]
  const counts = FOOT.map(([t, label]) => ({ t, label, n: panes.filter((p) => p.agent && p.tone === t).length })).filter((c) => c.n)
  const details = [`#${on.n}`, on.agent, on.agent ? (on.state ?? STATE[on.tone]) : on.cwd, on.branch].filter(Boolean).join(' · ')
  const sideW = 30 * CH
  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        background: T.surface,
        borderRadius: 12,
        boxShadow: `0 50px 140px #000d, 0 0 90px ${C.blue}12`,
        font: `400 ${FONT}px/${ROW}px ${MONO}`,
        color: T.fg,
        overflow: 'hidden',
        whiteSpace: 'pre',
        ...style
      }}
    >
      {/* the brand gradient round the window, like the CLI's container edges */}
      <div style={{ position: 'absolute', inset: 0, borderRadius: 12, padding: 1.5, background: BRAND_D, WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)', WebkitMaskComposite: 'xor', maskComposite: 'exclude', opacity: 0.85, zIndex: 5, pointerEvents: 'none' }} />

      {/* row 1: brand, tabs */}
      <div style={{ display: 'flex', height: ROW }}>
        <div style={{ width: sideW, paddingLeft: CH }}>
          <span style={{ fontWeight: 700, background: BRAND, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>sldev</span> <span style={{ color: T.subtle }}>{cli.version}</span>
        </div>
        <div style={{ width: CH }} />
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {panes.map((p) => (
            <span key={p.n} style={{ padding: `0 ${CH}px`, background: p.n === active ? T.raised : 'transparent', color: p.n === active ? T.fg : T.dim, fontWeight: p.n === active ? 600 : 400 }}>
              <Mark tone={p.tone} /> {p.n} {p.title}
            </span>
          ))}
          <span style={{ marginLeft: 'auto', padding: `0 ${CH}px`, color: T.subtle }}>+</span>
        </div>
      </div>

      {/* row 2: the brand line under the brand, the rule with the active tab underlined */}
      <div style={{ display: 'flex', height: ROW, alignItems: 'center' }}>
        <div style={{ width: sideW, height: 1.5, background: BRAND }} />
        <div style={{ width: CH }} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <TabUnderline panes={panes} active={active} />
          <div style={{ flex: 1, height: 1, background: T.rule }} />
          <span style={{ color: T.dim, padding: `0 ${CH}px` }}>
            {details}
            {on.stat && (
              <>
                {' · '}
                <span style={{ color: TONE.working }}>+{on.stat.ins}</span> <span style={{ color: TONE.error }}>-{on.stat.del}</span>
              </>
            )}
          </span>
          <div style={{ width: 2 * CH, height: 1, background: T.rule }} />
        </div>
      </div>

      {/* sidebar, edge, pane */}
      <div style={{ display: 'flex', height: height - 3 * ROW - 3 }}>
        <div style={{ width: sideW, display: 'flex', flexDirection: 'column', paddingTop: ROW / 2 }}>
          <div style={{ flex: 1 }}>
            {projects.map((project, gi) => {
              const list = panes.filter((p) => p.project === project)
              const tone = rollup(list)
              return (
                <div key={project} style={{ marginTop: gi ? ROW / 2 : 0 }}>
                  <div style={{ paddingLeft: CH }}>
                    <span style={{ color: T.dim, fontWeight: 600 }}>{project.toUpperCase()}</span> {tone === 'neutral' ? ' ' : <span style={{ color: TONE[tone] }}>●</span>} <Dim>{list.length}</Dim>
                  </div>
                  {list
                    .slice()
                    .sort((a, b) => Number(!a.agent) - Number(!b.agent))
                    .map((p) => {
                      const focus = p.n === active
                      const bar = <span style={{ color: C.blue }}>{focus ? '▌' : ' '}</span>
                      const indent = p.child ? '  ' : ''
                      return (
                        <div key={p.n} style={{ background: focus ? T.raised : 'transparent', overflow: 'hidden' }}>
                          <div>
                            {bar} {indent}
                            {p.child && <span style={{ color: T.subtle }}>└ </span>}
                            <Mark tone={p.tone} /> <Dim>{p.n}</Dim> {focus ? <Bold>{p.title}</Bold> : p.title}
                          </div>
                          <div>
                            {bar}
                            {'   '}
                            {indent}
                            {p.child ? '  ' : ''}
                            <Dim>{p.agent ? [p.agent, p.state ?? STATE[p.tone]].join(' · ') : p.cwd}</Dim>
                            {p.stat && (
                              <>
                                {' '}
                                <span style={{ color: TONE.working }}>+{p.stat.ins}</span> <span style={{ color: TONE.error }}>-{p.stat.del}</span>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                </div>
              )
            })}
          </div>
          <div style={{ borderTop: `1px solid ${T.rule}`, padding: `4px ${CH}px 8px`, display: 'flex', flexWrap: 'wrap', columnGap: 2 * CH }}>
            {counts.map((c) => (
              <span key={c.t}>
                <span style={{ color: TONE[c.t] }}>●</span>
                <Dim>
                  {' '}
                  {c.n} {c.label}
                </Dim>
              </span>
            ))}
          </div>
        </div>
        <div style={{ width: CH, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 1, background: `linear-gradient(180deg, ${C.blue}aa, ${C.green}aa, ${C.purple}aa)` }} />
        </div>
        <div style={{ flex: 1, background: T.bg, padding: `${ROW / 2}px ${2 * CH}px`, position: 'relative', overflow: 'hidden' }}>{children}</div>
      </div>

      {/* the status line */}
      <div style={{ display: 'flex', height: ROW, alignItems: 'center' }}>
        <span style={{ display: 'flex', gap: CH, paddingLeft: CH, flex: 1, overflow: 'hidden' }}>
          <span style={{ color: C.blue, fontWeight: 600 }}>^b</span>
          {HINTS.map(([k, what]) => (
            <span key={k} style={{ display: 'inline-flex', gap: CH }}>
              <span style={{ background: k === pressed ? C.blue : T.muted, color: k === pressed ? '#fff' : T.fg, fontWeight: 600, padding: `0 ${CH}px` }}>{k}</span>
              <Dim>{what}</Dim>
            </span>
          ))}
        </span>
        <span style={{ color: T.dim, padding: `0 ${CH}px` }}>
          {on.project} · {clock}
        </span>
      </div>

      {popup && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#0000004d', zIndex: 4 }}>{popup}</div>}
    </div>
  )
}

/** the heavy brand underline below the active tab, from its marker to the end of its title */
function TabUnderline({ panes, active }: { panes: Pane[]; active: number }) {
  let x = 0
  for (const p of panes) {
    const w = (`● ${p.n} ${p.title}`.length + 2) * CH
    if (p.n === active) return <div style={{ display: 'flex', flex: 'none', alignItems: 'center' }}>
      <div style={{ width: x + CH, height: 1, background: T.rule }} />
      <div style={{ width: w - 2 * CH, height: 2.5, background: BRAND }} />
      <div style={{ width: CH, height: 1, background: T.rule }} />
    </div>
    x += w
  }
  return null
}

/** a popup over the TUI: lifted surface, brand edge in full */
export function Popup({ title, width = 820, children }: { title: string; width?: number; children: ReactNode }) {
  return (
    <div style={{ position: 'relative', width, background: T.raised, padding: `${ROW / 2}px ${2 * CH}px`, boxShadow: '0 30px 90px #000c' }}>
      <div style={{ position: 'absolute', inset: 0, padding: 1.5, background: BRAND_D, WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)', WebkitMaskComposite: 'xor', maskComposite: 'exclude' }} />
      <div style={{ fontWeight: 600, marginBottom: ROW / 2 }}>{title}</div>
      {children}
    </div>
  )
}

/** a plain terminal window (the shell before sldev, or a second terminal running a script) */
export function Shell({ title = 'zsh — ~/acme-shop', width = 1300, height = 620, children, style }: { title?: string; width?: number; height?: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ width, height, borderRadius: 12, overflow: 'hidden', background: '#0b0b0b', border: '1px solid #2b2b2b', boxShadow: '0 50px 140px #000d', font: `400 ${FONT + 2}px/${ROW + 4}px ${MONO}`, color: T.fg, whiteSpace: 'pre', ...style }}>
      <div style={{ height: 40, display: 'flex', alignItems: 'center', padding: '0 16px', background: '#161616', borderBottom: '1px solid #232323', position: 'relative', font: `500 15px Inter, sans-serif`, color: C.muted }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[0, 1, 2].map((d) => (
            <span key={d} style={{ width: 12, height: 12, borderRadius: 99, background: '#3a3a3a' }} />
          ))}
        </div>
        <span style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center' }}>{title}</span>
      </div>
      <div style={{ padding: '20px 26px' }}>{children}</div>
    </div>
  )
}

export const PROMPT = <span style={{ color: C.green }}>~/acme-shop ❯ </span>
export function Cursor({ on = true }: { on?: boolean }) {
  const frame = useCurrentFrame()
  return <span style={{ display: 'inline-block', width: CH, height: FONT + 2, background: on && Math.floor(frame / 15) % 2 === 0 ? '#d0d0d0' : 'transparent', verticalAlign: -4, marginLeft: 2 }} />
}
