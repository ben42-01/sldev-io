/**
 * Several projects at once: what each one has going, for the title bar's project menu and Mission Control's
 * All projects view. Pure, so the order is tested; the renderer passes in missions and factory runs.
 */

export interface ProjectWork {
  root: string
  /** missions asking a question or factory runs waiting for an approval */
  needs: number
  /** missions or runs at work */
  working: number
  /** missions that finished a turn and wait for a review or a follow-up */
  ready: number
}

interface MissionLike {
  root: string
  status: string
}

interface RunLike {
  root: string
  status: string
  nodes: Record<string, { status: string }>
}

export function projectWork(missions: MissionLike[], runs: RunLike[] = []): Map<string, ProjectWork> {
  const out = new Map<string, ProjectWork>()
  const at = (root: string): ProjectWork => {
    let w = out.get(root)
    if (!w) out.set(root, (w = { root, needs: 0, working: 0, ready: 0 }))
    return w
  }
  for (const m of missions) {
    if (!m.root) continue
    if (m.status === 'needs-input') at(m.root).needs++
    else if (m.status === 'working' || m.status === 'starting') at(m.root).working++
    else if (m.status === 'waiting') at(m.root).ready++
  }
  for (const r of runs) {
    if (!r.root || r.status !== 'running') continue
    if (Object.values(r.nodes).some((n) => n.status === 'approval')) at(r.root).needs++
    else at(r.root).working++
  }
  return out
}

export const isBusy = (w: ProjectWork | undefined): boolean => !!w && w.needs + w.working + w.ready > 0

/**
 * The projects to offer, each once: the open one, then those with work going (the ones that need you first),
 * then recent ones, at most `max`.
 */
export function projectMenu(open: string | null, work: Map<string, ProjectWork>, recent: string[], max = 10): string[] {
  const busy = [...work.values()]
    .filter(isBusy)
    .sort((a, b) => b.needs - a.needs || b.working - a.working || b.ready - a.ready || a.root.localeCompare(b.root))
    .map((w) => w.root)
  const out: string[] = []
  for (const p of [open, ...busy, ...recent]) {
    if (out.length >= max) break
    if (p && !out.includes(p)) out.push(p)
  }
  return out
}

/** What a project has going, in a few words ("1 needs you · 2 working"), or '' when nothing. */
export function workLabel(w: ProjectWork | undefined): string {
  if (!w) return ''
  return [w.needs && `${w.needs} need${w.needs === 1 ? 's' : ''} you`, w.working && `${w.working} working`, w.ready && `${w.ready} ready`].filter(Boolean).join(' · ')
}
