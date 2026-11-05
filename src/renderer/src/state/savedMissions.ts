import type { SavedMission } from '@shared/types'
import { compareRecipe } from '@shared/factory'
import { renderKind } from '@shared/missionKinds'
import { getKind } from './missionKinds'
import { getProfile } from './profiles'
import { startRun } from './factory'
import { startMission } from './missions'
import { createStore, useStore } from './store'
import { workspace } from './workspace'

/** Missions written in the New mission form and kept to launch later. Nothing here runs on its own. */
export const saved = createStore<{ list: SavedMission[] }>({ list: [] })

let saveTimer: ReturnType<typeof setTimeout> | undefined

function persist(): void {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void window.api.store.set('savedMissions', { saved: saved.get().list }), 300)
}

export async function loadSaved(): Promise<void> {
  saved.set({ list: (await window.api.store.get('savedMissions'))?.saved ?? [] })
}

export function useSaved(project: string | null): SavedMission[] {
  return useStore(saved, (s) => s.list).filter((m) => m.project === project)
}

export const getSaved = (id: string): SavedMission | undefined => saved.get().list.find((m) => m.id === id)

export const newSavedId = (): string => `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** Adds it, or replaces the one with the same id (editing a saved mission keeps its place). */
export function putSaved(m: SavedMission): void {
  saved.set((s) => ({ list: s.list.some((x) => x.id === m.id) ? s.list.map((x) => (x.id === m.id ? m : x)) : [m, ...s.list] }))
  persist()
}

export function removeSaved(id: string): void {
  saved.set((s) => ({ list: s.list.filter((m) => m.id !== id) }))
  persist()
}

export const savedTitle = (m: Pick<SavedMission, 'title' | 'brief' | 'kind'>): string =>
  m.title?.trim() || m.brief.trim().split('\n')[0].slice(0, 60) || (m.kind === 'map' ? 'Map this project' : 'Untitled mission')

/**
 * Starts what the New mission form describes: one mission, or a factory bake-off when other agents are
 * ticked. The form's Launch and a saved mission's Launch both come here, so they can't drift apart.
 */
export async function launchSaved(m: SavedMission, isRepo: boolean): Promise<void> {
  const kind = getKind(m.kind)
  const title = savedTitle(m)
  const compare = isRepo && !kind.readOnly ? (m.compare ?? []) : []
  if (compare.length) {
    const profile = getProfile(m.options.profile)
    const first = m.options.agent || workspace.get().defaultAgent
    const ids = [first, ...compare.filter((c) => c !== first)]
    const specs = ids.map((id) => (profile ? `${profile.name}@${id}` : id))
    // the form's model, effort and mode are for its own agent; the others run on their defaults
    const mine = { model: m.options.model, effort: m.options.effort, mode: m.options.permissionMode }
    await startRun({ recipe: compareRecipe(specs, { [specs[0]]: mine }), intent: m.brief, root: m.root, base: m.base ?? '', issue: m.issue })
    return
  }
  const sent = renderKind(kind, { title, brief: m.brief, criteria: m.criteria ?? '' })
  await startMission({ prompt: sent, brief: m.brief, criteria: m.criteria, title, root: m.root, options: m.options, worktree: isRepo && m.worktree, base: m.base, kind: { id: kind.id, name: kind.name, readOnly: kind.readOnly } })
}

/** Launch a saved mission from its card; it leaves the saved list once it started. */
export async function launchSavedById(id: string): Promise<void> {
  const m = getSaved(id)
  if (!m) return
  if (!(await window.api.fs.isDir(m.root))) throw new Error(`The folder ${m.root} no longer exists. Edit the mission to pick another one.`)
  await launchSaved(m, await window.api.git.isRepo(m.root))
  removeSaved(id)
}
