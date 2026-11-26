// A repository's open pull requests, read through the user's gh, and the detached worktree a PR's head is
// checked out in for review. Pure: parsing gh's JSON and deciding what to do with an existing worktree.

import { currentRuns, summarizeChecks, type ShipRun } from './ship'

/** How many open PRs are asked for: enough for a review list, never a whole busy repository. */
export const OPEN_PR_LIMIT = 50

export const OPEN_PR_FIELDS = 'number,title,author,headRefName,headRefOid,baseRefName,isDraft,additions,deletions,changedFiles,reviewDecision,reviewRequests,createdAt,updatedAt,body,url'
/** The runs the list matches to PR heads: one read-only `gh run list` for the whole repository, never statusCheckRollup. */
export const PR_RUN_LIMIT = 100
export const PR_RUN_FIELDS = 'databaseId,workflowName,status,conclusion,headSha,createdAt,event'

export const PR_DETAIL_FIELDS = `${OPEN_PR_FIELDS},closingIssuesReferences`

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null

export interface OpenPr {
  number: number
  title: string
  /** the login, "someone" when GitHub has none (a deleted account) */
  author: string
  authorIsBot: boolean
  headRefName: string
  headSha: string
  baseRefName: string
  isDraft: boolean
  additions: number
  deletions: number
  changedFiles: number
  reviewDecision: ReviewDecision
  /** who is asked to review it and hasn't yet: user logins, and team names as "org/slug" */
  requested: string[]
  createdAt: string
  updatedAt: string
  body: string
  url: string
  /** the CI runs on its head commit; absent when they couldn't be read */
  checks?: PrChecks
}

/** What the Actions runs on a PR's head commit say: a failure wins, then anything still going, then all passed. */
export type PrChecks = 'passed' | 'failed' | 'running' | 'none'

export interface LinkedIssue {
  number: number
  title: string
  url: string
  /** "owner/repo" when GitHub says, which differs from the PR's repo for cross-repo links */
  repo?: string
}

export interface PrDetail extends OpenPr {
  linkedIssues: LinkedIssue[]
}

/** The open PRs, or why there are none to show: gh missing or logged out, not a GitHub repo, gh failing. */
export interface OpenPrList {
  prs: OpenPr[]
  /** the signed-in GitHub login, when gh says: "mine" and "waiting for my review" need it */
  me?: string
  error?: string
}

/** A PR's head checked out detached in its own worktree. */
export interface PrWorktree {
  number: number
  path: string
  /** the commit checked out */
  head: string
  /** the main checkout the worktree belongs to */
  repo: string
  /** what prWorktree did: made it, found it already at the head, or moved it to new commits */
  action: 'created' | 'reused' | 'moved'
  /** the head asked for (from the list) wasn't the one GitHub has now: new commits or a force push since */
  listedOther: boolean
}

type Raw = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {})

function decision(v: unknown): ReviewDecision {
  const s = str(v).toUpperCase()
  return s === 'APPROVED' || s === 'CHANGES_REQUESTED' || s === 'REVIEW_REQUIRED' ? s : null
}

function requests(v: unknown): string[] {
  return (Array.isArray(v) ? v : []).flatMap((x): string[] => {
    const r = obj(x)
    const who = str(r.login) || str(r.slug) || str(r.name)
    return who ? [who] : []
  })
}

/** One PR from gh's JSON; null for something that isn't one (no number). */
export function parseOpenPr(v: unknown): OpenPr | null {
  const r = obj(v)
  if (!Number.isInteger(r.number) || (r.number as number) <= 0) return null
  const author = obj(r.author)
  return {
    number: r.number as number,
    title: str(r.title),
    author: str(author.login) || 'someone',
    authorIsBot: author.is_bot === true,
    headRefName: str(r.headRefName),
    headSha: str(r.headRefOid),
    baseRefName: str(r.baseRefName),
    isDraft: r.isDraft === true,
    additions: num(r.additions),
    deletions: num(r.deletions),
    changedFiles: num(r.changedFiles),
    reviewDecision: decision(r.reviewDecision),
    requested: requests(r.reviewRequests),
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
    body: str(r.body),
    url: str(r.url)
  }
}

/** `gh pr list --json …` → the PRs, newest first, at most `limit`. Anything that isn't a list is no PRs. */
export function parseOpenPrs(json: unknown, limit = OPEN_PR_LIMIT): OpenPr[] {
  if (!Array.isArray(json)) return []
  return json
    .map(parseOpenPr)
    .filter((p): p is OpenPr => !!p)
    .sort((a, b) => (a.createdAt === b.createdAt ? b.number - a.number : a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit)
}

/** `gh pr view <n> --json …,closingIssuesReferences` → the PR with the issues it closes. */
export function parsePrDetail(json: unknown): PrDetail | null {
  const pr = parseOpenPr(json)
  if (!pr) return null
  const refs = obj(json).closingIssuesReferences
  // gh gives a list; the GraphQL shape ({ nodes: [...] }) is read too, in case an older gh passes it through
  const list = Array.isArray(refs) ? refs : Array.isArray(obj(refs).nodes) ? (obj(refs).nodes as unknown[]) : []
  const linkedIssues = list.flatMap((v): LinkedIssue[] => {
    const i = obj(v)
    if (!Number.isInteger(i.number)) return []
    const repo = obj(i.repository)
    const owner = str(obj(repo.owner).login)
    const name = str(repo.name)
    return [{ number: i.number as number, title: str(i.title), url: str(i.url), ...(owner && name ? { repo: `${owner}/${name}` } : {}) }]
  })
  return { ...pr, linkedIssues }
}

/** The ref a PR's head is fetched into: outside refs/heads, so it is never one of the user's branches. */
export const prRef = (n: number): string => `refs/sldev/pr/${n}`

/** The worktree folder of PR `n`, inside the app's worktree folder. */
export const prFolder = (n: number): string => `pr-${n}`

export function checkPrNumber(n: unknown): number {
  if (!Number.isInteger(n) || (n as number) <= 0) throw new Error(`Not a pull request number: ${String(n)}`)
  return n as number
}

/**
 * What to do for a PR worktree, given what is there now: nothing yet → create; already at the head → reuse;
 * at an older commit → move, but only when nothing tracked was changed there (moving would carry the edits over
 * or fail halfway), and only when it is detached (a branch checked out there was put there by hand).
 */
export type PrWorktreePlan = { do: 'create' } | { do: 'reuse' } | { do: 'move' } | { do: 'refuse'; reason: string }

export function planPrWorktree(existing: { head: string | null; branch: string | null; dirty: number } | null, headSha: string, n: number): PrWorktreePlan {
  if (!existing) return { do: 'create' }
  if (existing.branch) return { do: 'refuse', reason: `The worktree of PR #${n} has the branch ${existing.branch} checked out, so it isn't moved. Remove it, or check out the PR there by hand.` }
  if (existing.head === headSha) return { do: 'reuse' }
  if (existing.dirty > 0)
    return { do: 'refuse', reason: `PR #${n} has new commits, but its worktree has ${existing.dirty} changed file${existing.dirty === 1 ? '' : 's'}. Commit or discard them, or remove the worktree, then check it out again.` }
  return { do: 'move' }
}

// ── the review list ─────────────────────────────────────────────────

export type PrFilter = 'mine' | 'all'

/** Asked to review it, by name (a team's request isn't counted: gh doesn't say who is in the team). */
export const waitingForMe = (pr: OpenPr, me: string | undefined): boolean => !!me && pr.requested.some((r) => r.toLowerCase() === me.toLowerCase())

/** "Mine": the ones I opened or am asked to review. */
export const isMine = (pr: OpenPr, me: string | undefined): boolean => !!me && (pr.author.toLowerCase() === me.toLowerCase() || waitingForMe(pr, me))

/** What to review first: the ones waiting for my review, then the oldest (it has waited longest), drafts last. */
export function reviewOrder(prs: OpenPr[], me: string | undefined, filter: PrFilter = 'all'): OpenPr[] {
  const rank = (p: OpenPr): number => (waitingForMe(p, me) ? 0 : p.isDraft ? 2 : 1)
  return prs
    .filter((p) => filter === 'all' || isMine(p, me))
    .sort((a, b) => rank(a) - rank(b) || (a.createdAt === b.createdAt ? a.number - b.number : a.createdAt < b.createdAt ? -1 : 1))
}

/** The Review tab of PR `n`: its title as the tab's. */
export const prTabTitle = (pr: { number: number; title: string }): string => `#${pr.number} ${pr.title}`.trim()

// ── CI on each PR's head ─────────────────────────────────────────────

/** `gh run list --json …` → runs in the ship bar's shape; anything that isn't one is dropped. */
export function parsePrRuns(json: unknown): ShipRun[] {
  if (!Array.isArray(json)) return []
  return json.flatMap((v): ShipRun[] => {
    const r = obj(v)
    const headSha = str(r.headSha)
    if (!headSha) return []
    return [{ id: num(r.databaseId), workflow: str(r.workflowName), title: '', status: str(r.status), conclusion: str(r.conclusion), event: str(r.event), url: '', createdAt: str(r.createdAt), headSha }]
  })
}

/**
 * The checks of a PR's head: only runs on that exact commit count (an older commit's green run says nothing about
 * the new one), the newest of each workflow, summed up as the ship bar does.
 */
export function prChecks(runs: ShipRun[], headSha: string): PrChecks {
  if (!headSha) return 'none'
  const on = runs.filter((r) => r.headSha === headSha)
  if (!on.length) return 'none'
  const c = summarizeChecks(currentRuns(on, headSha).runs)
  return c.failed ? 'failed' : c.pending ? 'running' : 'passed'
}

/** Each PR with the checks of its head commit. */
export const withChecks = (prs: OpenPr[], runs: ShipRun[]): OpenPr[] => prs.map((p) => ({ ...p, checks: prChecks(runs, p.headSha) }))
