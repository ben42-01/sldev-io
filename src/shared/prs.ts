// A repository's open pull requests, read through the user's gh, and the detached worktree a PR's head is
// checked out in for review. Pure: parsing gh's JSON and deciding what to do with an existing worktree.

/** How many open PRs are asked for: enough for a review list, never a whole busy repository. */
export const OPEN_PR_LIMIT = 50

export const OPEN_PR_FIELDS = 'number,title,author,headRefName,headRefOid,baseRefName,isDraft,additions,deletions,changedFiles,reviewDecision,createdAt,updatedAt,body,url'
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
  createdAt: string
  updatedAt: string
  body: string
  url: string
}

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
