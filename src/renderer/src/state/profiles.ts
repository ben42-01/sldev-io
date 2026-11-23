import { STARTER_PROFILES } from '@shared/profiles'
import type { AgentOptions, AgentProfile } from '@shared/types'
import { createStore, useStore } from './store'
import { workspace } from './workspace'

/** Profiles from the open project's .sldev/agents; user profiles live in settings. */
const project = createStore<{ root: string | null; list: AgentProfile[]; loading: boolean }>({ root: null, list: [], loading: false })

export async function loadProjectProfiles(root: string | null): Promise<void> {
  project.set({ ...project.get(), loading: !!root })
  const list = root ? await window.api.profiles.list(root).catch(() => []) : []
  project.set({ root, list, loading: false })
}

/** The open project's profiles as read from .sldev/agents, and whether a read is in flight. */
export const useProjectProfiles = (): { list: AgentProfile[]; loading: boolean } => useStore(project, (p) => p)

/** Installs a team template into the project and reloads its profiles. Existing role files are kept. */
export async function installTeam(root: string, team: string): Promise<{ written: string[]; skipped: string[] }> {
  const r = await window.api.profiles.installTeam(root, team)
  await loadProjectProfiles(root)
  return r
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

/** Every profile a mission in `root` can use, read now: that project's, then the user's and the starters (root may not be the open project). */
export async function profilesFor(root: string): Promise<AgentProfile[]> {
  return merge(workspace.get().agentProfiles ?? [], await window.api.profiles.list(root).catch(() => project.get().root === root ? project.get().list : []))
}

export const getProfile = (id: string | undefined): AgentProfile | undefined => (id ? allProfiles().find((p) => p.id === id) : undefined)

/** The role to hand the agent for these options, if a profile is picked. */
export const roleFor = (o: AgentOptions): string | undefined => getProfile(o.profile)?.role || undefined
