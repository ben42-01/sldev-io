import { ArrowRight, Download, EyeOff, Infinity as Forever, SquarePen } from 'lucide-react'
import type { ReactNode } from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import site from '../../../../website/src/content/site.json'
import { C, MONO, SERIF, UI, beats, enter, pop, progress, typed } from '../lib'
import { Brand, Button, Headline, Logo, Pill, Pointer, Reveal, type State } from '../ui'

function Term({ agent, state, lines, from, width = 640, children }: { agent: string; state: State; lines: Array<[number, string, string?]>; from: number; width?: number; children?: ReactNode }) {
  const frame = useCurrentFrame()
  const p = pop(frame, from)
  return (
    <div style={{ width, height: 470, background: C.panel, border: `1px solid ${state === 'limit' ? `${C.amber}aa` : C.borderStrong}`, boxShadow: `0 30px 90px #000c${state === 'working' ? `, 0 0 50px ${C.blue}22` : ''}`, opacity: p, transform: `scale(${0.92 + 0.08 * p})`, position: 'relative', fontFamily: UI }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, background: C.elev, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 18, color: C.fg }}>{agent}</span>
        <span style={{ marginLeft: 'auto' }}>
          <Pill state={state} />
        </span>
      </div>
      <div style={{ padding: '14px 18px', fontFamily: MONO, fontSize: 18, lineHeight: 1.7, color: '#cfcfcf' }}>
        {lines.map(([at, text, tone], i) => (frame >= at ? <div key={i} style={{ color: tone ?? '#cfcfcf' }}>{typed(text, frame, at, 60)}</div> : null))}
      </div>
      {children}
    </div>
  )
}

/** Claude stops at its usage limit; one click and Codex carries on with the same task and notes. */
export function Failover() {
  const frame = useCurrentFrame()
  const handed = frame >= beats(10)
  const arrow = progress(frame, beats(10), 12)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Headline at={0} out={beats(9)}>Hit your usage limit mid-task?</Headline>
      <Headline at={beats(10)}>Another agent picks it up. Same task, same branch.</Headline>
      <div style={{ display: 'flex', alignItems: 'center', gap: 40, marginTop: 120 }}>
        <Term
          agent="Claude Code"
          state={frame >= beats(4) ? 'limit' : 'working'}
          from={0}
          lines={[
            [4, '● Reading src/checkout.ts'],
            [16, '● Editing src/checkout.ts'],
            [32, '● Adding retry with backoff…'],
            [beats(4), 'Usage limit reached.', C.amber],
            [beats(4) + 8, 'Resets at 3pm.', C.amber]
          ]}
        >
          {frame >= beats(5) && (
            <div style={{ position: 'absolute', left: 18, right: 18, bottom: 18, padding: '14px 16px', border: `1px solid ${C.amber}66`, background: `${C.amber}10`, display: 'flex', alignItems: 'center', gap: 12, ...enter(frame, beats(5), { rise: 12 }) }}>
              <span style={{ color: C.amber, fontSize: 16, flex: 1 }}>Claude Code stopped at its usage limit.</span>
              <Button primary glow={frame > beats(8) && frame < beats(10) ? 1 : 0}>Continue on Codex</Button>
            </div>
          )}
        </Term>
        <div style={{ width: 90, opacity: arrow, transform: `translateX(${(1 - arrow) * -30}px)`, color: C.green }}>
          <ArrowRight size={90} strokeWidth={1.5} />
        </div>
        <div style={{ opacity: handed ? 1 : 0.15 }}>
          <Term
            agent="Codex"
            state={handed ? 'working' : 'ready'}
            from={handed ? beats(10) : 0}
            lines={
              handed
                ? [
                    [beats(10) + 6, "› Picking up where Claude Code stopped", C.green],
                    [beats(11), "› Reading its notes and partial diff"],
                    [beats(12), '› Editing src/checkout.ts'],
                    [beats(13), '› Running npm test'],
                    [beats(14) + 8, '  ✓ 26 passed', C.green]
                  ]
                : []
            }
          />
        </div>
      </div>
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <Pointer
          path={[
            [0, 1100, 950],
            [beats(6), 1100, 950],
            [beats(8), 690, 805]
          ]}
          click={[beats(9)]}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

const AGENTS = ['Claude Code', 'Codex', 'Cursor Agent', 'GitHub Copilot', 'Gemini CLI', 'OpenCode', 'your own CLI']
const VALUES = [
  { icon: SquarePen, title: 'Not an IDE', text: 'Your files open in your own editor.' },
  { icon: Forever, title: 'No new AI subscription', text: 'It runs the agents you already have.' },
  { icon: EyeOff, title: 'No telemetry', text: 'It all runs on your machine.' }
]

/** Agent-agnostic, then what it is not. */
export function Agents() {
  const frame = useCurrentFrame()
  const second = beats(10)
  const out = 1 - progress(frame, second - 8, 8)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: UI }}>
      <Headline at={0} out={second - 8} top={300} size={76}>
        {'Bring the agents you *already use.*'}
      </Headline>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 18, width: 1400, marginTop: 220, opacity: out }}>
        {AGENTS.map((a, i) => {
          const p = pop(frame, beats(1 + i))
          return (
            <div key={a} style={{ padding: '18px 30px', fontSize: 34, fontWeight: 600, border: `1px solid ${i === AGENTS.length - 1 ? C.border : C.borderStrong}`, background: C.elev, color: i === AGENTS.length - 1 ? C.muted : C.fg, opacity: p, transform: `translateY(${(1 - p) * 30}px) scale(${0.9 + 0.1 * p})` }}>
              {a}
            </div>
          )
        })}
      </div>
      {frame >= second - 8 && (
        <>
          <Headline at={second} top={300} size={76}>
            Built around how you already work.
          </Headline>
          <div style={{ position: 'absolute', top: 520, display: 'flex', gap: 28 }}>
            {VALUES.map((v, i) => {
              const Icon = v.icon
              return (
                <div key={v.title} style={{ width: 440, padding: '34px 32px', background: C.bg, border: `1px solid ${C.border}`, borderTop: '2px solid transparent', borderImage: `linear-gradient(90deg, ${C.blue}, ${C.green}, ${C.purple}) 1`, borderImageSlice: '1 0 0 0', ...enter(frame, second + beats(1 + i), { rise: 30 }) }}>
                  <Icon size={34} strokeWidth={1.5} color={C.green} />
                  <div style={{ fontSize: 34, fontWeight: 700, marginTop: 18, letterSpacing: '-0.02em' }}>{v.title}</div>
                  <div style={{ fontSize: 24, color: C.muted, marginTop: 8 }}>{v.text}</div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </AbsoluteFill>
  )
}

/** Logo, offer, platforms and the URL, from the website's content files. */
export function Cta() {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const end = interpolate(frame, [durationInFrames - 24, durationInFrames - 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: UI, opacity: end }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 26, ...enter(frame, 0, { dur: 10, rise: 0 }) }}>
        <Logo size={120} />
        <div style={{ font: `700 116px/1 ${UI}`, letterSpacing: '-0.05em' }}>
          <Brand>{site.name}</Brand>
        </div>
      </div>
      <Reveal text={site.tagline} at={beats(1)} stagger={2} style={{ marginTop: 26, font: `italic 400 50px/1.2 ${SERIF}`, color: '#a8a8a8' }} />
      <div style={{ display: 'flex', gap: 18, marginTop: 56, ...enter(frame, beats(2)) }}>
        <Button primary style={{ fontSize: 30, padding: '18px 30px', gap: 14 }}>
          <Download size={30} /> Download free
        </Button>
        <Button style={{ fontSize: 30, padding: '18px 30px' }}>Open source</Button>
      </div>
      <div style={{ fontSize: 26, color: C.subtle, marginTop: 34, letterSpacing: '0.04em', ...enter(frame, beats(3)) }}>{site.platforms.join('  ·  ')}</div>
      <div style={{ fontSize: 44, fontWeight: 600, marginTop: 50, fontFamily: MONO, ...enter(frame, beats(4)) }}>{site.url.replace(/^https?:\/\//, '')}</div>
    </AbsoluteFill>
  )
}
