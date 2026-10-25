import type { Mission, MissionStatus, StatusChange } from './types'

/** Enough for weeks of a busy mission; the oldest entries go first. */
export const HISTORY_LIMIT = 500

/** The mission with `patch` applied, recording a status change in its history. */
export function patchMission(m: Mission, patch: Partial<Mission>, now: number): Mission {
  const next: Mission = { ...m, ...patch, updatedAt: now }
  if (patch.status && patch.status !== m.status) next.history = pushStatus(m.history, patch.status, now)
  return next
}

export function pushStatus(history: StatusChange[] | undefined, status: MissionStatus, at: number): StatusChange[] {
  return [...(history ?? []), { status, at }].slice(-HISTORY_LIMIT)
}
