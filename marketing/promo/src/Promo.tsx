import type { ComponentType, ReactNode } from 'react'
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { C, UI, bars, beats } from './lib'
import { Backdrop, Chapter, Grain, SceneTag } from './ui'
import { Agents, Cta, Failover } from './scenes/Closing'
import { BoardScene } from './scenes/BoardScene'
import { EvalsScene } from './scenes/EvalsScene'
import { FactoryScene } from './scenes/FactoryScene'
import { Intro } from './scenes/Intro'
import { LeadScene } from './scenes/LeadScene'
import { Missions } from './scenes/Missions'
import { ReviewScene } from './scenes/ReviewScene'
import { ShipScene } from './scenes/ShipScene'
import timeline from './timeline.json'

// The story, in bars of the track (2 s each at 120 BPM), from src/timeline.json, which the music
// script reads too, so the arrangement follows the scenes. Every cut lands on a downbeat.
const COMPONENTS: Record<string, ComponentType> = {
  intro: Intro,
  board: BoardScene,
  missions: Missions,
  lead: LeadScene,
  factory: FactoryScene,
  failover: Failover,
  review: ReviewScene,
  evals: EvalsScene,
  ship: ShipScene,
  agents: Agents,
  cta: Cta
}

interface SceneDef {
  id: string
  bars: number
  chapter?: string
  /** the feature's name, shown top left */
  tag?: string
}
const DEFS = timeline.scenes as SceneDef[]
const CHAPTERS = DEFS.filter((s) => s.chapter).map((s) => s.id)

/** each scene's chapter: the last one that started at or before it */
const chapterOf = (i: number): string | undefined => DEFS.slice(0, i + 1).reverse().find((s) => s.chapter)?.chapter
export const SCENES = DEFS.map((s, i) => ({ ...s, Scene: COMPONENTS[s.id], backdrop: s.id !== 'intro', inChapter: chapterOf(i) }))
export const DURATION = SCENES.reduce((n, s) => n + bars(s.bars), 0)

/** a chapter title holds the first beat and a half; the scene's own clock starts under it */
export const CHAPTER_LEAD = beats(1.5)
const CHAPTER_DUR = beats(2)
/** the outgoing scene keeps playing this long under the incoming one, zooming through */
const OVERLAP = 8

export interface PromoProps {
  /** a file in public/, e.g. "music.mp3"; null renders without sound */
  music: string | null
  [key: string]: unknown
}

/** In: a quick push out of a blur. Out (after the cut): it keeps zooming towards you and dissolves. */
function Through({ len, first, children }: { len: number; first: boolean; children: ReactNode }) {
  const frame = useCurrentFrame()
  const inP = first ? 1 : interpolate(frame, [0, 7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const outP = interpolate(frame, [len, len + OVERLAP], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const scale = (1 + 0.05 * (1 - inP)) * (1 + 0.14 * outP ** 1.5)
  const blur = 10 * (1 - inP) + 14 * outP
  return <AbsoluteFill style={{ opacity: inP * (1 - outP), transform: `scale(${scale})`, filter: blur > 0.3 ? `blur(${blur}px)` : undefined }}>{children}</AbsoluteFill>
}

export function Promo({ music }: PromoProps) {
  const { durationInFrames, fps } = useVideoConfig()
  let at = 0
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.fg, fontFamily: UI }}>
      {SCENES.map(({ id, bars: n, Scene, backdrop, chapter, tag, inChapter }, i) => {
        const from = at
        const len = bars(n)
        at += len
        const last = i === SCENES.length - 1
        return (
          <Sequence key={id} name={id} from={from} durationInFrames={len + (last ? 0 : OVERLAP)}>
            <Through len={len} first={i === 0}>
              {backdrop && <Backdrop />}
              {chapter ? (
                <Sequence from={CHAPTER_LEAD} name={`${id} (scene)`}>
                  <Scene />
                </Sequence>
              ) : (
                <Scene />
              )}
              {tag && inChapter && (
                <Sequence from={chapter ? CHAPTER_LEAD : 0} name={`${id} (tag)`}>
                  <SceneTag chapter={inChapter} n={DEFS.filter((d) => d.chapter).findIndex((d) => d.chapter === inChapter) + 1} name={tag} />
                </Sequence>
              )}
              {chapter && <Chapter n={CHAPTERS.indexOf(id) + 1} of={CHAPTERS.length} word={chapter} dur={CHAPTER_DUR} />}
            </Through>
          </Sequence>
        )
      })}
      <Grain />
      {music && (
        <Audio
          src={staticFile(music)}
          volume={(f) => interpolate(f, [0, fps / 4, durationInFrames - fps * 1.5, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
        />
      )}
    </AbsoluteFill>
  )
}
