import { BUILTIN_KINDS, findKind, kindDraft, type MissionKind } from '@shared/missionKinds'
import { createStore, useStore } from './store'

/** Custom kinds from the project's .sldev/missions and the user folder; the built-ins come first. */
const custom = createStore<{ root: string | null; list: MissionKind[] }>({ root: null, list: [] })

export async function loadKinds(root: string | null): Promise<void> {
  custom.set({ root, list: await window.api.kinds.list(root).catch(() => []) })
}

export const allKinds = (): MissionKind[] => [...BUILTIN_KINDS, ...custom.get().list]

export function useKinds(): MissionKind[] {
  const list = useStore(custom, (s) => s.list)
  return [...BUILTIN_KINDS, ...list]
}

export const getKind = (id: string | undefined): MissionKind => findKind(allKinds(), id)

/** A new kind file, copied from `from`; returns its path for the editor. */
export async function createKind(scope: 'project' | 'user', root: string | null, name: string, from: MissionKind): Promise<string> {
  const p = await window.api.kinds.create(scope, root, name, kindDraft(from, name))
  await loadKinds(root)
  return p
}
