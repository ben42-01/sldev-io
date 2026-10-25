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
