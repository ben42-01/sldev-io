import type { ComponentType } from 'react'
import { Film, filmLength, type FilmProps, type SceneDef } from './Film'
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

// The app's advert: the story in src/timeline.json, a component per scene.
const SCENES: Record<string, ComponentType> = {
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

// the intro draws its own pile of terminals, without the backdrop
const DEFS: SceneDef[] = (timeline.scenes as SceneDef[]).map((s) => (s.id === 'intro' ? { ...s, bare: true } : s))
export const DURATION = filmLength(DEFS)
export type PromoProps = FilmProps

export function Promo({ music }: PromoProps) {
  return <Film defs={DEFS} scenes={SCENES} music={music} />
}
