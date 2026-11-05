import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { BRAND, C, UI, bars } from './lib'
import { Backdrop, Grain } from './ui'
import { Agents, Cta, Failover } from './scenes/Closing'
import { FactoryScene } from './scenes/FactoryScene'
import { Missions } from './scenes/Missions'
import { INTRO_BARS, Intro } from './scenes/Intro'
import { Review } from './scenes/Review'

// The story, in bars of the track (2 s each at 120 BPM). Every cut lands on a downbeat.
export const SCENES = [
  // chaos (5 bars), the turn (2) and the logo on the drop (2), as one continuous shot
  { id: 'intro', bars: INTRO_BARS, Scene: Intro, backdrop: false },
  { id: 'missions', bars: 8, Scene: Missions, backdrop: true },
  { id: 'review', bars: 5, Scene: Review, backdrop: true },
  { id: 'factory', bars: 8, Scene: FactoryScene, backdrop: true },
  { id: 'failover', bars: 5, Scene: Failover, backdrop: true },
  { id: 'agents', bars: 5, Scene: Agents, backdrop: true },
  { id: 'cta', bars: 4, Scene: Cta, backdrop: true }
] as const

export const DURATION = SCENES.reduce((n, s) => n + bars(s.bars), 0)

export interface PromoProps {
  /** a file in public/, e.g. "music.mp3"; null renders without sound */
  music: string | null
  [key: string]: unknown
}

/** The brand gradient sweeps across the top at every cut. */
function Cut() {
  const frame = useCurrentFrame()
  const p = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' })
  const o = interpolate(frame, [10, 22], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return <div style={{ position: 'absolute', left: 0, top: 0, height: 4, width: '100%', background: BRAND, transform: `scaleX(${p})`, transformOrigin: 'left', opacity: o, zIndex: 100 }} />
}

export function Promo({ music }: PromoProps) {
  const { durationInFrames, fps } = useVideoConfig()
  let at = 0
  return (
    <AbsoluteFill style={{ background: '#0a0a0a', color: C.fg, fontFamily: UI }}>
      {SCENES.map(({ id, bars: n, Scene, backdrop }) => {
        const from = at
        at += bars(n)
        return (
          <Sequence key={id} name={id} from={from} durationInFrames={bars(n)}>
            {backdrop && <Backdrop />}
            <Scene />
            <Cut />
          </Sequence>
        )
      })}
      <Grain />
      {music && (
        <Audio
          src={staticFile(music)}
          volume={(f) => interpolate(f, [0, fps / 2, durationInFrames - fps * 2, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
        />
      )}
    </AbsoluteFill>
  )
}
