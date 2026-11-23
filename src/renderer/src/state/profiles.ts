import { STARTER_PROFILES } from '@shared/profiles'
import type { AgentOptions, AgentProfile } from '@shared/types'
import { createStore, useStore } from './store'
import { workspace } from './workspace'

/** Profiles from the open project's .sldev/agents; user profiles live in settings. */
const project = createStore<{ root: string | null; list: AgentProfile[] }>({ root: null, list: [] })

export async function loadProjectProfiles(root: string | null): Promise<void> {
  const list = root ? await window.api.profiles.list(root).catch(() => []) : []
  project.set({ root, list })
}

/** Installs a team template into the project and reloads its profiles. Existing role files are kept. */
export async function installTeam(root: string, team: string): Promise<{ written: string[]; skipped: string[] }> {
  const r = await window.api.profiles.installTeam(root, team)
  await loadProjectProfiles(root)
  return r
}

const merge = (user: AgentProfile[], proj: AgentProfile[]): AgentProfile[] => [...proj, ...user, ...STARTER_PROFILES]

export function allProfiles(): AgentProfile[] {
  return merge(workspace.get().agentProfiles ?? [], project.get().list)
}

export function useProfiles(): AgentProfile[] {
  const user = useStore(workspace, (w) => w.agentProfiles)
  const proj = useStore(project, (p) => p.list)
  return merge(user ?? [], proj)
}

export const getProfile = (id: string | undefined): AgentProfile | undefined => (id ? allProfiles().find((p) => p.id === id) : undefined)

/** The role to hand the agent for these options, if a profile is picked. */
export const roleFor = (o: AgentOptions): string | undefined => getProfile(o.profile)?.role || undefined
