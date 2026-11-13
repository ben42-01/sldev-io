import type { RepoStats, StatsPart } from '@shared/types'

/** What the GitHub stats panel says and links to; pure, so it is unit-tested. */

/** How often the panel reads again while it is on screen. Hidden, it doesn't read at all. */
export const STATS_REFRESH_MS = 60_000

const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`

/** The repository's GitHub URL, when gh could read it. */
export const repoUrl = (s: RepoStats): string | null => s.github.value?.url ?? null

/** Links on GitHub for each tile; null when there's no GitHub repo to link to. */
export function statsLinks(s: RepoStats): { pulls: string; issues: string; releases: string; actions: string; release: string | null; commit: string | null } | null {
  const url = repoUrl(s)
  if (!url) return null
  const tag = s.release.value?.tag
  const sha = s.lastCommit.value?.sha
  return {
    pulls: `${url}/pulls`,
    issues: `${url}/issues`,
    releases: `${url}/releases`,
    actions: `${url}/actions`,
    release: tag ? `${url}/releases/tag/${encodeURIComponent(tag)}` : null,
    commit: sha ? `${url}/commit/${sha}` : null
  }
}

/** gh is missing or logged out: the panel shows the local tiles and a "Set up gh" hint instead of GitHub's. */
export const needsGhSetup = (s: RepoStats): boolean => !!s.githubError

/** The branch tile: its name, and "2 ahead, 1 behind origin/main" or why there is nothing to compare. */
export function branchSummary(s: RepoStats): { value: string; sub: string } {
  const st = s.status.value
  if (!st) return { value: '—', sub: s.status.error ?? 'No git status' }
  const name = st.branch ?? (st.head ? `detached at ${st.head.slice(0, 7)}` : 'no commits yet')
  if (!st.upstream) return { value: name, sub: st.detached ? 'Detached HEAD: no upstream' : 'No upstream branch' }
  if (!st.ahead && !st.behind) return { value: name, sub: `Up to date with ${st.upstream}` }
  if (!st.behind) return { value: name, sub: `${st.ahead} ahead of ${st.upstream}` }
  return { value: name, sub: `${st.ahead ? `${st.ahead} ahead, ` : ''}${st.behind} behind ${st.upstream}` }
}

/** A count tile's numbers: the value, or "—" with the reason when the part failed. */
export function countTile(part: StatsPart<unknown>, n: number | undefined): { value: string; failed: boolean; why?: string } {
  if (part.error) return { value: '—', failed: true, why: part.error }
  return { value: n === undefined ? '—' : String(n), failed: false }
}

/** The sub-line of the open PRs tile: what is open for the current branch. */
export function branchPrsLine(s: RepoStats): string {
  const prs = s.branchPrs.value
  const branch = s.status.value?.branch
  if (s.branchPrs.error) return "Couldn't read this branch's PRs"
  if (!branch) return 'Detached HEAD'
  if (!prs?.length) return `None for ${branch}`
  return `${plural(prs.length, 'PR')} for ${branch}`
}
