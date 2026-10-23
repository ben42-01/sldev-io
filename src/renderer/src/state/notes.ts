import { createStore } from './store'

/** Bumped whenever a note is created/saved/deleted so lists refresh. */
export const notesVersion = createStore<{ v: number }>({ v: 0 })
export const bumpNotes = (): void => notesVersion.set((s) => ({ v: s.v + 1 }))
