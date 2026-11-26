import { promises as fsp } from 'fs'
import { join } from 'path'
import { parse as parseYaml } from 'yaml'
import { prSearch, rangeFrom } from '@shared/gitStats'
import type { ActivityPr, GhIssue, GhPr, GhPrComment, GhPrReview, GhRepoInfo, GhRun, GhWorkflow, GhWorkflowInput, RepoBranchPr, RepoCommit, RepoGithub, RepoActivity, RepoRelease, RepoStats, StatsPart } from '@shared/types'
import { pickPr, type MergeMethod, type ShipPr, type ShipRun, type ShipStatus } from '@shared/ship'
import { checkPrNumber, OPEN_PR_FIELDS, OPEN_PR_LIMIT, parseOpenPrs, parsePrDetail, PR_DETAIL_FIELDS, type OpenPrList, type PrDetail } from '@shared/prs'
import { activityCommits, run, status as gitStatus } from './git'

const gh = (args: string[], cwd: string, timeout = 30000): ReturnType<typeof run> => run('gh', args, cwd, timeout)

/** `empty` is what an empty answer means: gh prints nothing (not `[]`) for a repo without workflows. */
async function ghJson<T>(args: string[], cwd: string, empty?: T): Promise<T> {
  const r = await gh(args, cwd)
  if (r.code !== 0) throw new Error(r.stderr.trim() || `gh ${args.join(' ')} failed`)
  if (!r.stdout.trim() && empty !== undefined) return empty
  try {
    return JSON.parse(r.stdout) as T
  } catch {
    throw new Error(`Unexpected output from gh ${args.slice(0, 2).join(' ')}. Check that gh is up to date (gh --version).`)
  }
}

/** Why gh can't be used at all, or null when it is installed and logged in. */
async function ghProblem(cwd: string): Promise<string | null> {
  const auth = await gh(['auth', 'status'], cwd)
  if (auth.code === 0) return null
  return /ENOENT|not found/i.test(auth.stderr) ? 'The GitHub CLI (gh) is not installed.' : 'Not logged in to GitHub. Run `gh auth login`.'
}

export async function repoInfo(cwd: string): Promise<GhRepoInfo> {
  const problem = await ghProblem(cwd)
  if (problem) return { authed: false, repo: null, url: null, defaultBranch: null, error: problem }
  try {
    const r = await ghJson<{ nameWithOwner: string; url: string; defaultBranchRef: { name: string } | null }>(['repo', 'view', '--json', 'nameWithOwner,url,defaultBranchRef'], cwd)
    return { authed: true, repo: r.nameWithOwner, url: r.url, defaultBranch: r.defaultBranchRef?.name ?? null }
  } catch (e) {
    return { authed: true, repo: null, url: null, defaultBranch: null, error: 'This folder is not a GitHub repository.' + (e instanceof Error ? ` (${e.message.split('\n')[0]})` : '') }
  }
}

export const listWorkflows = (cwd: string): Promise<GhWorkflow[]> => ghJson(['workflow', 'list', '--all', '--json', 'id,name,path,state'], cwd, [])

const RUN_FIELDS = 'databaseId,displayTitle,workflowName,status,conclusion,headBranch,event,createdAt,url,number'

export const listRuns = (cwd: string, workflow?: string): Promise<GhRun[]> =>
  ghJson(['run', 'list', '--limit', '30', ...(workflow ? ['--workflow', workflow] : []), '--json', RUN_FIELDS], cwd, [])

/** Inputs declared under `on.workflow_dispatch.inputs` in the local workflow file. null = not dispatchable. */
export async function workflowInputs(cwd: string, path: string): Promise<GhWorkflowInput[] | null> {
  const text = await fsp.readFile(join(cwd, path), 'utf8').catch(() => null)
  if (!text) return null
  let doc: Record<string | number, unknown>
  try {
    doc = parseYaml(text) ?? {}
  } catch {
    return null
  }
  const on = (doc.on ?? doc['true']) as unknown
  if (on === 'workflow_dispatch' || (Array.isArray(on) && on.includes('workflow_dispatch'))) return []
  const wd = on && typeof on === 'object' && !Array.isArray(on) ? (on as Record<string, unknown>).workflow_dispatch : undefined
  if (wd === undefined) return null
  const inputs = (wd && typeof wd === 'object' ? (wd as Record<string, unknown>).inputs : null) as Record<string, Record<string, unknown>> | null
  return Object.entries(inputs ?? {}).map(([name, v]) => ({
    name,
    description: typeof v?.description === 'string' ? v.description : undefined,
    required: !!v?.required,
    default: v?.default !== undefined ? String(v.default) : undefined,
    type: typeof v?.type === 'string' ? v.type : 'string',
    options: Array.isArray(v?.options) ? v.options.map(String) : undefined
  }))
}

export async function dispatchWorkflow(cwd: string, id: number, ref: string, inputs: Record<string, string>): Promise<void> {
  const args = ['workflow', 'run', String(id), '--ref', ref]
  for (const [k, v] of Object.entries(inputs)) if (v !== '') args.push('-f', `${k}=${v}`)
  const r = await gh(args, cwd)
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'gh workflow run failed')
}

export async function rerun(cwd: string, runId: number, failedOnly: boolean): Promise<void> {
  const r = await gh(['run', 'rerun', String(runId), ...(failedOnly ? ['--failed'] : [])], cwd)
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'gh run rerun failed')
}

export async function cancelRun(cwd: string, runId: number): Promise<void> {
  const r = await gh(['run', 'cancel', String(runId)], cwd)
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'gh run cancel failed')
}

export async function currentPr(cwd: string): Promise<GhPr | null> {
  const r = await gh(['pr', 'view', '--json', 'number,title,state,url,isDraft,statusCheckRollup'], cwd)
  if (r.code !== 0) return null
  let pr
  try {
    pr = JSON.parse(r.stdout)
  } catch {
    return null
  }
  const checks = { passed: 0, failed: 0, pending: 0 }
  for (const c of pr.statusCheckRollup ?? []) {
    const v = String(c.conclusion || c.state || c.status || '').toUpperCase()
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(v)) checks.passed++
    else if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(v)) checks.failed++
    else checks.pending++
  }
  return { number: pr.number, title: pr.title, state: pr.state, url: pr.url, isDraft: pr.isDraft, checks }
}

/** Pull request `n` for the Review tab: what it says, where it goes and its diff. */
export async function prReview(cwd: string, n: number): Promise<GhPrReview> {
  const pr = await ghJson<{ number: number; title?: string; body?: string; url?: string; headRefOid?: string; headRefName?: string; baseRefName?: string }>(['pr', 'view', String(n), '--json', 'number,title,body,url,headRefOid,headRefName,baseRefName'], cwd)
  const d = await gh(['pr', 'diff', String(n)], cwd, 60000)
  if (d.code !== 0) throw new Error(d.stderr.trim() || `gh pr diff ${n} failed`)
  return { number: pr.number, title: pr.title ?? `#${n}`, body: pr.body ?? '', url: pr.url ?? '', head: pr.headRefOid ?? '', branch: pr.headRefName ?? '', base: pr.baseRefName ?? '', diff: d.stdout }
}

export async function listIssues(cwd: string, label?: string): Promise<GhIssue[]> {
  const list = await ghJson<Array<Omit<GhIssue, 'labels'> & { labels?: { name: string }[] }>>(['issue', 'list', '--state', 'open', '--limit', '50', ...(label ? ['--label', label] : []), '--json', 'number,title,body,url,labels'], cwd, [])
  return list.map((i) => ({ ...i, labels: (i.labels ?? []).map((l) => l.name) }))
}

/** A pull request's state: OPEN, MERGED or CLOSED; null when gh can't tell. */
export async function prState(cwd: string, n: number): Promise<'OPEN' | 'MERGED' | 'CLOSED' | null> {
  const r = await ghJson<{ state?: string } | null>(['pr', 'view', String(n), '--json', 'state'], cwd, null)
  const s = r?.state?.toUpperCase()
  return s === 'OPEN' || s === 'MERGED' || s === 'CLOSED' ? s : null
}

/**
 * The newest pull request opened from `branch`, in any state: how the board finds the PR of a card
 * that ran as a mission (its Pull request button pushes the worktree branch). Null when there is none.
 */
export async function prForBranch(cwd: string, branch: string): Promise<{ number: number; state: 'OPEN' | 'MERGED' | 'CLOSED' } | null> {
  const list = await ghJson<Array<{ number?: number; state?: string }>>(['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number,state'], cwd, [])
  const pr = list[0]
  const s = pr?.state?.toUpperCase()
  return pr?.number && (s === 'OPEN' || s === 'MERGED' || s === 'CLOSED') ? { number: pr.number, state: s } : null
}

interface Author { login?: string }

/** Everything reviewers wrote on PR `n`: reviews, conversation comments and line comments. */
export async function prComments(cwd: string, n: number): Promise<GhPrComment[]> {
  const [view, lines] = await Promise.all([
    ghJson<{ comments: { id: string; author: Author; body: string; createdAt: string; url: string }[]; reviews: { id: string; author: Author; body: string; submittedAt: string; state: string }[] }>(
      ['pr', 'view', String(n), '--json', 'comments,reviews,url'],
      cwd
    ),
    // {owner}/{repo} is filled in by gh from the repository in cwd
    ghJson<{ id: number; user: Author; body: string; created_at: string; html_url: string; path: string; line: number | null; original_line: number | null }[]>(
      ['api', `repos/{owner}/{repo}/pulls/${n}/comments`, '--paginate'],
      cwd,
      []
    )
  ])
  const who = (a: Author | null | undefined): string => a?.login || 'someone'
  return [
    ...view.reviews.map((r) => ({ id: `review-${r.id}`, author: who(r.author), body: r.body, createdAt: r.submittedAt, url: '' })),
    ...view.comments.map((c) => ({ id: `comment-${c.id}`, author: who(c.author), body: c.body, createdAt: c.createdAt, url: c.url })),
    ...lines.map((c) => ({ id: `line-${c.id}`, author: who(c.user), body: c.body, createdAt: c.created_at, url: c.html_url, path: c.path, line: c.line ?? c.original_line ?? undefined }))
  ]
}

async function part<T>(work: () => Promise<T | null>): Promise<StatsPart<T>> {
  try {
    return { value: await work() }
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message.split('\n')[0] : String(e) }
  }
}

async function lastCommit(cwd: string): Promise<RepoCommit | null> {
  const r = await run('git', ['log', '-1', '--format=%H%x00%h%x00%s%x00%an%x00%aI'], cwd)
  // a repository without commits has nothing to show, which isn't an error
  if (r.code !== 0) {
    if (/does not have any commits|bad default revision/i.test(r.stderr)) return null
    throw new Error(r.stderr.trim() || 'git log failed')
  }
  const [sha, short, subject, author, date] = r.stdout.replace(/\n$/, '').split('\0')
  return sha ? { sha, short, subject, author, date } : null
}

/**
 * The data of scripts/gh-stats.sh as JSON. Local parts come from git and are always tried; the GitHub
 * parts run in parallel through gh, each failing on its own. Only read-only gh commands: auth status,
 * repo view, release list, run list, pr list.
 */
export async function repoStats(cwd: string): Promise<RepoStats> {
  const statusP = part(() => gitStatus(cwd))
  const commitP = part(() => lastCommit(cwd))
  const problem = await ghProblem(cwd)
  const status = await statusP
  const branch = status.value?.branch ?? null
  const local = { status, lastCommit: await commitP }
  if (problem) {
    const failed = { value: null, error: problem }
    return { ...local, githubError: problem, github: failed, release: failed, runs: failed, branchPrs: failed }
  }
  const [github, release, runs, branchPrs] = await Promise.all([
    part<RepoGithub>(async () => {
      const r = await ghJson<{ nameWithOwner: string; url: string; defaultBranchRef: { name: string } | null; stargazerCount: number; forkCount: number; issues: { totalCount: number }; pullRequests: { totalCount: number } }>(
        ['repo', 'view', '--json', 'nameWithOwner,url,defaultBranchRef,stargazerCount,forkCount,issues,pullRequests'],
        cwd
      )
      return {
        repo: r.nameWithOwner,
        url: r.url,
        defaultBranch: r.defaultBranchRef?.name ?? null,
        stars: r.stargazerCount ?? 0,
        forks: r.forkCount ?? 0,
        openIssues: r.issues?.totalCount ?? 0,
        openPrs: r.pullRequests?.totalCount ?? 0
      }
    }),
    part<RepoRelease>(async () => {
      const list = await ghJson<{ tagName: string; name: string | null; publishedAt: string | null; isPrerelease: boolean }[]>(
        ['release', 'list', '--limit', '1', '--exclude-drafts', '--json', 'tagName,name,publishedAt,isPrerelease'],
        cwd,
        []
      )
      const r = list[0]
      return r ? { tag: r.tagName, name: r.name || r.tagName, publishedAt: r.publishedAt ?? '', prerelease: !!r.isPrerelease } : null
    }),
    part<GhRun[]>(() => ghJson(['run', 'list', '--limit', '3', ...(branch ? ['--branch', branch] : []), '--json', RUN_FIELDS], cwd, [])),
    part<RepoBranchPr[]>(async () =>
      branch ? ghJson(['pr', 'list', '--head', branch, '--state', 'open', '--limit', '10', '--json', 'number,title,url,isDraft'], cwd, []) : []
    )
  ])
  return { ...local, github, release, runs, branchPrs }
}

/**
 * The activity charts' data for the last `days` days: commits from git (always tried) and pull requests through
 * gh (read-only `pr list`; fails on its own, with the reason, when gh is missing or logged out).
 */
export async function repoActivity(cwd: string, days: number): Promise<RepoActivity> {
  const from = rangeFrom(days, Date.now())
  const commitsP = part(() => activityCommits(cwd, from))
  const prs = await part<ActivityPr[]>(async () => {
    const problem = await ghProblem(cwd)
    if (problem) throw new Error(problem)
    return ghJson(['pr', 'list', '--state', 'all', '--limit', '1000', '--search', prSearch(from), '--json', 'number,createdAt,mergedAt,closedAt'], cwd, [])
  })
  return { days, from, commits: await commitsP, prs }
}

/**
 * The Review tab's ship bar: the branch's PR, the workflow runs on it and what git knows locally (uncommitted
 * files, commits origin doesn't have). Read-only: git commands that don't touch the network, and gh's
 * pr list and run list. The git part is always there; GitHub failing only fills `error`.
 */
export async function shipStatus(cwd: string, branch: string): Promise<ShipStatus> {
  const [sha, porcelain, remote] = await Promise.all([
    run('git', ['rev-parse', 'HEAD'], cwd),
    run('git', ['status', '--porcelain'], cwd),
    run('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], cwd)
  ])
  const localSha = sha.stdout.trim()
  const uncommitted = porcelain.stdout.split('\n').filter(Boolean).length
  let unpushed: number | null = null
  if (remote.code === 0) {
    const r = await run('git', ['rev-list', '--count', `refs/remotes/origin/${branch}..HEAD`], cwd)
    unpushed = Number(r.stdout.trim()) || 0
  }
  const local = { branch, localSha, unpushed, uncommitted, pr: null, runs: [] }
  const problem = await ghProblem(cwd)
  if (problem) return { ...local, error: problem }
  try {
    const [prs, runs] = await Promise.all([
      ghJson<Array<Omit<ShipPr, 'mergeState' | 'base' | 'headSha'> & { mergeStateStatus?: string; baseRefName?: string; headRefOid?: string }>>(
        ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '5', '--json', 'number,title,state,url,isDraft,mergeable,mergeStateStatus,reviewDecision,baseRefName,headRefOid'],
        cwd,
        []
      ),
      ghJson<Array<GhRun & { headSha?: string }>>(['run', 'list', '--branch', branch, '--limit', '30', '--json', `${RUN_FIELDS},headSha`], cwd, [])
    ])
    const p = pickPr(prs.map((x) => ({ ...x, state: String(x.state).toUpperCase() })))
    const pr: ShipPr | null = p
      ? {
          number: p.number,
          title: p.title,
          state: p.state === 'MERGED' || p.state === 'CLOSED' ? p.state : 'OPEN',
          url: p.url,
          isDraft: !!p.isDraft,
          mergeable: String(p.mergeable ?? 'UNKNOWN').toUpperCase(),
          mergeState: String(p.mergeStateStatus ?? 'UNKNOWN').toUpperCase(),
          reviewDecision: String(p.reviewDecision ?? '').toUpperCase(),
          base: p.baseRefName ?? '',
          headSha: p.headRefOid ?? ''
        }
      : null
    const shipRuns: ShipRun[] = runs.map((r) => ({
      id: r.databaseId,
      workflow: r.workflowName,
      title: r.displayTitle,
      status: r.status,
      conclusion: r.conclusion,
      event: r.event,
      url: r.url,
      createdAt: r.createdAt,
      headSha: r.headSha ?? ''
    }))
    return { ...local, pr, runs: shipRuns }
  } catch (e) {
    return { ...local, error: e instanceof Error ? e.message.split('\n')[0] : String(e) }
  }
}

/**
 * Merge PR `n` on GitHub, only if its head is still `headSha` (what the reviewer looked at). `auto` asks
 * GitHub to merge once the required checks pass. Nothing local changes: no checkout, no branch deleted.
 */
export async function mergePr(cwd: string, n: number, method: MergeMethod, headSha: string, auto: boolean): Promise<string> {
  if (!['squash', 'merge', 'rebase'].includes(method)) throw new Error(`Unknown merge method: ${method}`)
  if (!/^[0-9a-f]{7,40}$/i.test(headSha)) throw new Error('The PR head commit is unknown; refresh and try again')
  const r = await gh(['pr', 'merge', String(n), `--${method}`, '--match-head-commit', headSha, ...(auto ? ['--auto'] : [])], cwd, 60000)
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'gh pr merge failed')
  return (r.stdout + r.stderr).trim() || (auto ? `#${n} will merge once its checks pass` : `Merged #${n}`)
}

/**
 * The repository's open pull requests, newest first (at most OPEN_PR_LIMIT), with author, size, draft and review
 * decision. Read-only `gh pr list`. Without gh, logged out, or outside a GitHub repository, `error` says which.
 */
export async function openPrs(cwd: string): Promise<OpenPrList> {
  const problem = await ghProblem(cwd)
  if (problem) return { prs: [], error: problem }
  try {
    const json = await ghJson<unknown>(['pr', 'list', '--state', 'open', '--limit', String(OPEN_PR_LIMIT), '--json', OPEN_PR_FIELDS], cwd, [])
    return { prs: parseOpenPrs(json) }
  } catch (e) {
    return { prs: [], error: e instanceof Error ? e.message.split('\n')[0] : String(e) }
  }
}

/** PR `n` with its body and the issues it closes (read-only `gh pr view`). Throws a readable reason. */
export async function prDetail(cwd: string, n: number): Promise<PrDetail> {
  checkPrNumber(n)
  const problem = await ghProblem(cwd)
  if (problem) throw new Error(problem)
  const pr = parsePrDetail(await ghJson<unknown>(['pr', 'view', String(n), '--json', PR_DETAIL_FIELDS], cwd))
  if (!pr) throw new Error(`GitHub has no pull request #${n} here.`)
  return pr
}
