import type { ComponentType } from 'react'
import { Film, filmLength, type FilmProps, type SceneDef } from '../Film'
import { Agents, Attach, Branches, Conductor, Cta, Failover, Open, Repeat, Script } from './Scenes'
import timeline from './timeline.json'

// The CLI's advert: the story in src/cli/timeline.json (music: npm run music:cli), a component per scene.
const SCENES: Record<string, ComponentType> = { open: Open, attach: Attach, branches: Branches, failover: Failover, repeat: Repeat, conductor: Conductor, script: Script, agents: Agents, cta: Cta }
const DEFS = timeline.scenes as SceneDef[]
export const CLI_DURATION = filmLength(DEFS)

export function CliPromo({ music }: FilmProps) {
  return <Film defs={DEFS} scenes={SCENES} music={music} />
}
