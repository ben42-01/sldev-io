import type { ComponentType, ReactNode } from 'react'
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { C, UI, bars, beats } from './lib'
import { Backdrop, Chapter, Grain, SceneTag } from './ui'

// A film is a timeline (src/timeline.json for the app, src/cli/timeline.json for the CLI) and a component per
// scene. The music script reads the same timeline, so the arrangement follows the scenes and every cut lands on
// a downbeat (a bar is 2 s at 120 BPM).

export interface SceneDef {
  id: string
  bars: number
  chapter?: string
  /** the feature's name, shown top left */
  tag?: string
  /** draw the scene on its own background, without the shared backdrop */
  bare?: boolean
}

export interface FilmProps {
  /** a file in public/, e.g. "music.mp3"; null renders without sound */
  music: string | null
  [key: string]: unknown
}

/** a chapter title holds the first beat and a half; the scene's own clock starts under it */
export const CHAPTER_LEAD = beats(1.5)
const CHAPTER_DUR = beats(2)
/** the outgoing scene keeps playing this long under the incoming one, zooming through */
const OVERLAP = 8

export const filmLength = (defs: SceneDef[]): number => defs.reduce((n, s) => n + bars(s.bars), 0)

/** In: a quick push out of a blur. Out (after the cut): it keeps zooming towards you and dissolves. */
function Through({ len, first, children }: { len: number; first: boolean; children: ReactNode }) {
  const frame = useCurrentFrame()
  const inP = first ? 1 : interpolate(frame, [0, 7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const outP = interpolate(frame, [len, len + OVERLAP], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const scale = (1 + 0.05 * (1 - inP)) * (1 + 0.14 * outP ** 1.5)
  const blur = 10 * (1 - inP) + 14 * outP
  return <AbsoluteFill style={{ opacity: inP * (1 - outP), transform: `scale(${scale})`, filter: blur > 0.3 ? `blur(${blur}px)` : undefined }}>{children}</AbsoluteFill>
}

export function Film({ defs, scenes, music }: { defs: SceneDef[]; scenes: Record<string, ComponentType>; music: string | null }) {
  const { durationInFrames, fps } = useVideoConfig()
  const chapters = defs.filter((s) => s.chapter)
  /** each scene's chapter: the last one that started at or before it */
  const chapterOf = (i: number): string | undefined => defs.slice(0, i + 1).reverse().find((s) => s.chapter)?.chapter
  let at = 0
  return (
    <AbsoluteFill style={{ background: C.bg, color: C.fg, fontFamily: UI }}>
      {defs.map(({ id, bars: n, chapter, tag, bare }, i) => {
        const Scene = scenes[id]
        const inChapter = chapterOf(i)
        const from = at
        const len = bars(n)
        at += len
        const last = i === defs.length - 1
        return (
          <Sequence key={id} name={id} from={from} durationInFrames={len + (last ? 0 : OVERLAP)}>
            <Through len={len} first={i === 0}>
              {!bare && <Backdrop />}
              {chapter ? (
                <Sequence from={CHAPTER_LEAD} name={`${id} (scene)`}>
                  <Scene />
                </Sequence>
              ) : (
                <Scene />
              )}
              {tag && inChapter && (
                <Sequence from={chapter ? CHAPTER_LEAD : 0} name={`${id} (tag)`}>
                  <SceneTag chapter={inChapter} n={chapters.findIndex((d) => d.chapter === inChapter) + 1} name={tag} />
                </Sequence>
              )}
              {chapter && <Chapter n={chapters.findIndex((d) => d.id === id) + 1} of={chapters.length} word={chapter} dur={CHAPTER_DUR} />}
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
