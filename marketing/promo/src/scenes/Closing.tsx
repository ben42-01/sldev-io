import { ArrowRight, Download, Laptop, SquarePen, Star } from 'lucide-react'
import type { ReactNode } from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import site from '../../../../website/src/content/site.json'
import { C, MONO, STORY, UI, beats, enter, pop, progress, story, typed } from '../lib'
import { Brand, Button, Camera, Headline, Logo, Pill, Pointer, Reveal, Scrim, type State } from '../ui'

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

/** the scene was timed for a longer cut; every beat is scaled to fit its bars */
const bt = (n: number): number => beats(n * 0.95)

/** Claude stops at its usage limit; one click and Codex carries on with the same task and notes. */
export function Failover() {
  const frame = useCurrentFrame()
  const handed = frame >= bt(10)
  const arrow = progress(frame, bt(10), 12)
  return (
    <AbsoluteFill>
      <Camera
        keys={[
          [0, { x: 120, y: 30, z: 1.0, rx: 8, ry: 12 }],
          [bt(4), { x: 160, y: 20, z: 1.06, ry: 8 }],
          [bt(9), { x: 140, y: 20, z: 1.06, ry: 6 }],
          [bt(11), { x: -140, y: 20, z: 1.06, ry: -8 }],
          [bt(16), { x: -160, y: 20, z: 1.08, ry: -10 }]
        ]}
      >
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 40, marginTop: 120 }}>
        <Term
          agent="Claude Code"
          state={frame >= bt(4) ? 'limit' : 'working'}
          from={0}
          lines={[
            [4, '● Reading src/checkout.ts'],
            [16, '● Editing src/checkout.ts'],
            [32, '● Adding retry with backoff…'],
            [bt(4), 'Usage limit reached.', C.amber],
            [bt(4) + 8, 'Resets at 3pm.', C.amber]
          ]}
        >
          {frame >= bt(5) && (
            <div style={{ position: 'absolute', left: 18, right: 18, bottom: 18, padding: '14px 16px', border: `1px solid ${C.amber}66`, background: `${C.amber}10`, display: 'flex', alignItems: 'center', gap: 12, ...enter(frame, bt(5), { rise: 12 }) }}>
              <span style={{ color: C.amber, fontSize: 16, flex: 1 }}>Claude Code stopped at its usage limit.</span>
              <Button primary glow={frame > bt(8) && frame < bt(10) ? 1 : 0}>Continue on Codex</Button>
            </div>
          )}
        </Term>
        <div style={{ width: 90, opacity: arrow, transform: `translateX(${(1 - arrow) * -30}px)`, color: C.green }}>
          <ArrowRight size={90} strokeWidth={1.5} />
        </div>
        <div style={{ opacity: handed ? 1 : 0.4, filter: handed ? undefined : 'grayscale(1)' }}>
          <Term
            agent="Codex"
            state={handed ? 'working' : 'ready'}
            from={handed ? bt(10) : 0}
            lines={
              handed
                ? [
                    [bt(10) + 6, "› Picking up where Claude Code stopped", C.green],
                    [bt(11), "› Reading its notes and partial diff"],
                    [bt(12), '› Editing src/checkout.ts'],
                    [bt(13), '› Running npm test'],
                    [bt(14) + 8, '  ✓ 26 passed', C.green]
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
            [bt(6), 1100, 950],
            [bt(8), 690, 805]
          ]}
          click={[bt(9)]}
        />
      </AbsoluteFill>
      </AbsoluteFill>
      </Camera>
      <Scrim />
      <Headline at={0} out={bt(9.4)}>{'Hit your usage limit *mid-task?*'}</Headline>
      <Headline at={bt(10)}>{'Codex picks it up. *Same branch.*'}</Headline>
    </AbsoluteFill>
  )
}

// the agents come from the website, so the advert lists what the site lists; the last one is "Any CLI"
const AGENTS = site.agents
const VALUES = [
  { icon: SquarePen, title: 'Not an IDE.', text: 'Your files open in the editor you already use.' },
  { icon: Laptop, title: 'Runs on your machine.', text: 'No cloud in between, no telemetry.' },
  { icon: Star, title: 'Free and open source.', text: 'Every feature, no account, no license key.' }
]
const NAME_AT = (i: number): number => beats(1 + i * 1.15)
const SECOND = beats(10)

/** Agent-agnostic, as a slot that lands one name per beat and a bit, then three things it is not. */
export function Agents() {
  const frame = useCurrentFrame()
  const first = 1 - progress(frame, SECOND - 8, 8)
  const current = AGENTS.reduce((n, _, i) => (frame >= NAME_AT(i) ? i : n), 0)
  return (
    <AbsoluteFill style={{ fontFamily: UI }}>
      {frame < SECOND && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: first }}>
          <div style={{ font: story(64), letterSpacing: STORY.spacing, color: C.muted, ...enter(frame, 0, { rise: 16 }) }}>Bring the agent you already use</div>
          <div style={{ position: 'relative', height: 190, width: 1800, marginTop: 20, overflow: 'hidden' }}>
            {AGENTS.map((a, i) => {
              const inP = progress(frame, NAME_AT(i), 9)
              const outP = i < AGENTS.length - 1 ? progress(frame, NAME_AT(i + 1), 9) : 0
              if (inP <= 0 || outP >= 1) return null
              const last = i === AGENTS.length - 1
              return (
                <div key={a} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `translateY(${(1 - inP) * 120 - outP * 120}px)`, opacity: inP * (1 - outP) ** 3, filter: `blur(${(1 - inP) * 8 + outP * 12}px)` }}>
                  <span style={{ font: `700 150px/1.1 ${UI}`, letterSpacing: '-0.05em', ...(last ? { background: `linear-gradient(90deg, ${C.blue}, ${C.green}, ${C.purple})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', padding: '0 0.05em' } : { color: C.fg }) }}>{a}</span>
                </div>
              )
            })}
          </div>
          {/* the ones already named collect underneath */}
          <div style={{ display: 'flex', gap: 14, marginTop: 30, height: 46 }}>
            {AGENTS.map((a, i) => (
              <span key={a} style={{ padding: '8px 16px', border: `1px solid ${i === current ? C.green : C.borderStrong}`, color: i === current ? C.fg : C.muted, fontSize: 20, fontWeight: 600, background: C.elev, opacity: pop(frame, NAME_AT(i) + 4), transform: `scale(${0.8 + 0.2 * pop(frame, NAME_AT(i) + 4)})` }}>
                {a}
              </span>
            ))}
          </div>
        </AbsoluteFill>
      )}
      {frame >= SECOND - 4 && (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 56 }}>
          {VALUES.map((v, i) => {
            const Icon = v.icon
            const at = SECOND + beats(i * 1.6)
            return (
              <div key={v.title} style={{ display: 'flex', alignItems: 'center', gap: 40, ...enter(frame, at, { rise: 40, dur: 14 }) }}>
                <div style={{ width: 104, height: 104, display: 'grid', placeItems: 'center', border: `1px solid ${C.borderStrong}`, background: C.elev, borderRadius: 18, boxShadow: `0 0 40px ${[C.blue, C.green, C.purple][i]}22` }}>
                  <Icon size={50} strokeWidth={1.5} color={[C.blue, C.green, C.purple][i]} />
                </div>
                <div>
                  <div style={{ font: `700 76px/1.05 ${UI}`, letterSpacing: '-0.04em' }}>{v.title}</div>
                  <div style={{ font: story(36, 1.3), letterSpacing: STORY.spacing, color: C.muted, marginTop: 6 }}>{v.text}</div>
                </div>
              </div>
            )
          })}
          </div>
        </AbsoluteFill>
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
      {/* an aurora turning slowly behind the mark */}
      <div style={{ position: 'absolute', left: 960, top: 470, width: 1300, height: 1300, transform: `translate(-50%, -50%) rotate(${frame * 0.6}deg) scale(${0.8 + 0.2 * pop(frame, 0, 20)})`, borderRadius: '50%', background: `conic-gradient(from 0deg, ${C.blue}00, ${C.blue}40, ${C.green}40, ${C.purple}40, ${C.blue}00 70%)`, filter: 'blur(90px)', opacity: 0.55 }} />
      <div style={{ position: 'absolute', left: 960, top: 470, width: 1500 * progress(frame, 0, 40), height: 1500 * progress(frame, 0, 40), transform: 'translate(-50%, -50%)', borderRadius: '50%', border: `1px solid ${C.green}`, opacity: 0.5 * (1 - progress(frame, 0, 40)) }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 26, ...enter(frame, 0, { dur: 10, rise: 0 }), position: 'relative', overflow: 'hidden', padding: '0 20px' }}>
        {/* a glint across the wordmark */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, width: 160, left: interpolate(frame, [beats(1), beats(2.5)], [-200, 1100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }), background: 'linear-gradient(100deg, transparent, #ffffff30, transparent)', mixBlendMode: 'screen' }} />
        <Logo size={150} />
        <div style={{ font: `700 150px/1.1 ${UI}`, letterSpacing: '-0.05em' }}>
          <Brand>{site.name}</Brand>
        </div>
      </div>
      <Reveal text={site.tagline} at={beats(1)} stagger={2} style={{ marginTop: 22, font: story(58, 1.2), letterSpacing: STORY.spacing, color: '#c4c4c4' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 70, ...enter(frame, beats(2.5)) }}>
        <Button primary glow={0.6 + 0.4 * Math.sin(frame / 9)} style={{ fontSize: 38, padding: '22px 38px', gap: 16, borderRadius: 8 }}>
          <Download size={36} /> Download free
        </Button>
        <div style={{ fontSize: 34, color: C.muted }}>
          <span style={{ color: C.fg, fontWeight: 700 }}>Open source</span>, Apache-2.0
        </div>
      </div>
      <div style={{ fontSize: 24, color: C.muted, marginTop: 26, letterSpacing: '0.02em', ...enter(frame, beats(3.5)) }}>Star it on GitHub · {site.platforms.join(' · ')}</div>
      <div style={{ fontSize: 56, fontWeight: 600, marginTop: 64, fontFamily: MONO, letterSpacing: '-0.02em', ...enter(frame, beats(5)) }}>{site.url.replace(/^https?:\/\//, '')}</div>
    </AbsoluteFill>
  )
}
