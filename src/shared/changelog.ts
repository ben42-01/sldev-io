/** One release in website/src/content/changelog.json, newest first. */
export interface ChangelogEntry {
  version: string
  /** YYYY-MM-DD, or null until the release is cut (the website lists only dated entries) */
  date: string | null
  changes: string[]
}

/**
 * The releases to show after an update: everything newer than `lastSeen`, up to and including
 * `current`. A first launch (no `lastSeen`) shows nothing, and so does a version the changelog
 * doesn't know.
 */
export function unseenChanges(log: ChangelogEntry[], current: string, lastSeen: string | null): ChangelogEntry[] {
  if (!lastSeen || lastSeen === current) return []
  const from = log.findIndex((e) => e.version === current)
  if (from === -1) return []
  const to = log.findIndex((e) => e.version === lastSeen)
  return log.slice(from, to === -1 ? undefined : to)
}

export const released = (log: ChangelogEntry[]): ChangelogEntry[] => log.filter((e) => e.date !== null)
