import { execFile } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { basename, dirname, join } from 'path'
import { BRANCH_LIST_FORMAT, parseBranchList, parseRemoteBranches, parseStatus, parseWorktrees } from '@shared/git'
import { COMMIT_LOG_FORMAT, parseCommitLog, sinceArg } from '@shared/gitStats'
import { GRAPH_LOG_FORMAT, githubWebUrl, parseGraphLog, type GraphLog } from '@shared/gitGraph'
import { parseGrep, type Use } from '@shared/review'
import type { BaseMoved } from '@shared/ship'
import { checkPrNumber, planPrWorktree, prFolder, prRef, type PrWorktree } from '@shared/prs'
import type { ActivityCommit, DiffStat, GitBranchList, GitStatus, GitWorktree, WorktreeInfo, WorktreeStatus } from '@shared/types'

interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export function run(cmd: string, args: string[], cwd: string, timeout = 30000): Promise<ExecResult> {
  return new Promise((resolve) => {
    // windowsHide: from a process without a console (the CLI daemon, the app) every git/gh/docker call
    // would otherwise flash a console window of its own on Windows
    execFile(cmd, args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' } }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr: stderr || (err && !stderr ? String(err.message) : '') })
    )
  })
}

const git = (args: string[], cwd: string, timeout?: number): Promise<ExecResult> => run('git', args, cwd, timeout)

async function ok(args: string[], cwd: string, timeout?: number): Promise<string> {
  const r = await git(args, cwd, timeout)
  if (r.code !== 0) throw new Error(r.stderr.trim() || `git ${args[0]} failed`)
  return r.stdout
}

export async function gitBranch(cwd: string): Promise<string | null> {
  const r = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  return r.code === 0 ? r.stdout.trim() || null : null
}

export async function head(cwd: string): Promise<string | null> {
  const r = await git(['rev-parse', 'HEAD'], cwd)
  return r.code === 0 ? r.stdout.trim() : null
}

/** How many commits HEAD has after `from`; null when `from` is gone or no longer in HEAD's history (a rebase, a reset). */
export async function commitsSince(cwd: string, from: string): Promise<number | null> {
  if (!/^[0-9a-f]{7,64}$/i.test(from)) return null
  const anc = await git(['merge-base', '--is-ancestor', from, 'HEAD'], cwd)
  if (anc.code !== 0) return null
  const r = await git(['rev-list', '--count', `${from}..HEAD`], cwd)
  return r.code === 0 ? Number(r.stdout.trim()) || 0 : null
}

export async function isRepo(cwd: string): Promise<boolean> {
  return (await git(['rev-parse', '--is-inside-work-tree'], cwd)).stdout.trim() === 'true'
}

export async function branches(cwd: string): Promise<string[]> {
  const r = await git(['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads'], cwd)
  return r.code === 0 ? r.stdout.split('\n').filter(Boolean) : []
}

/**
 * Check out `branch`, only from a working tree without uncommitted changes to tracked files: git itself
 * would carry them over to the other branch, or refuse when they'd be overwritten. Either way nothing
 * changes until the tree is clean, and the error lists the files. Untracked files are left to git.
 */
export async function switchBranch(cwd: string, branch: string): Promise<void> {
  if (!branch || branch.startsWith('-')) throw new Error(`Not a branch: "${branch}"`)
  const dirty = (await ok(['status', '--porcelain', '--untracked-files=no'], cwd)).split('\n').filter(Boolean)
  if (dirty.length) {
    const files = dirty.slice(0, 20).map((l) => `\t${l.slice(3)}`)
    if (dirty.length > 20) files.push(`\t… and ${dirty.length - 20} more`)
    throw new Error(`error: Your local changes would be carried over to ${branch}:\n${files.join('\n')}\nPlease commit or stash them before you switch branches.\nAborting`)
  }
  await ok(['switch', branch], cwd)
}

/** Local and remote-tracking branches with their last commit, most recent first. */
export async function branchList(cwd: string): Promise<GitBranchList> {
  const root = (await git(['rev-parse', '--show-toplevel'], cwd)).stdout.trim()
  return parseBranchList(await ok(['for-each-ref', '--sort=-committerdate', `--format=${BRANCH_LIST_FORMAT}`, 'refs/heads', 'refs/remotes'], cwd), root || cwd)
}

/** Branch, upstream, ahead/behind and counts of staged, unstaged, untracked and conflicted files. */
export async function status(cwd: string): Promise<GitStatus> {
  return parseStatus(await ok(['status', '--porcelain=v2', '--branch', '--untracked-files=all'], cwd))
}

/** Fetch every remote and drop remote branches that are gone. Never pushes. */
export async function fetch(cwd: string): Promise<string> {
  const r = await git(['fetch', '--all', '--prune'], cwd, 120000)
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'git fetch failed')
  // git reports what it fetched on stderr
  return (r.stdout + r.stderr).trim()
}

/**
 * Fast-forward the current branch to its upstream, and nothing else: no merge commit, no rebase,
 * whatever pull.rebase / pull.ff say. A branch that has diverged fails with git's own message.
 */
export async function pull(cwd: string): Promise<string> {
  const r = await git(['-c', 'pull.rebase=false', '-c', 'pull.ff=only', 'pull', '--ff-only', '--no-rebase', '--no-edit'], cwd, 120000)
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'git pull failed')
  return (r.stdout + r.stderr).trim()
}

/**
 * Create branch `name` at `base` (HEAD when empty), and check it out when `switchTo`. The name goes
 * through `git check-ref-format --branch` first, so git never sees a name it would reject or reinterpret.
 */
export async function createBranch(cwd: string, name: string, base: string, switchTo: boolean): Promise<string> {
  const branch = await checkBranchName(cwd, name)
  if (base.startsWith('-')) throw new Error(`Not a valid base: "${base}"`)
  const start = base.trim() ? [base.trim()] : []
  if (switchTo) await ok(['switch', '--no-track', '-c', branch, ...start], cwd)
  else await ok(['branch', '--no-track', branch, ...start], cwd)
  return branch
}

/** The trimmed name when git would take it as a branch exactly as written; throws otherwise. */
async function checkBranchName(cwd: string, name: string): Promise<string> {
  const branch = name.trim()
  // a leading dash would be read as an option by the commands that follow
  if (!branch || branch.startsWith('-')) throw new Error(`Not a valid branch name: "${name}"`)
  const check = await git(['check-ref-format', '--branch', branch], cwd)
  // check-ref-format expands "@{-1}" and the like into another branch's name; only take names as written
  if (check.code !== 0 || check.stdout.trim() !== branch) throw new Error(`Not a valid branch name: "${name}"`)
  return branch
}

/** The checked-out branch, or the commit when HEAD is detached. */
async function currentRef(cwd: string): Promise<string> {
  const b = await gitBranch(cwd)
  return (b && b !== 'HEAD' ? b : await head(cwd)) || 'HEAD'
}

const branchExists = async (repo: string, branch: string): Promise<boolean> => (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repo)).code === 0

/** Every worktree of the repository `cwd` belongs to, the main one first. */
export async function listWorktrees(cwd: string): Promise<GitWorktree[]> {
  // -z (git 2.36+) keeps paths with newlines whole; older git gets the line form
  const z = await git(['worktree', 'list', '--porcelain', '-z'], cwd)
  return parseWorktrees(z.code === 0 ? z.stdout : await ok(['worktree', 'list', '--porcelain'], cwd))
}

/** Remote-tracking branches ("origin/main"), most recent commit first. */
export async function remoteBranches(cwd: string): Promise<string[]> {
  return parseRemoteBranches(await ok(['for-each-ref', '--sort=-committerdate', '--format=%(refname)', 'refs/remotes'], cwd))
}

/**
 * Where board pick-up starts a card: the project's default branch (`wanted` when set, else `<remote>/HEAD`, else
 * main or master) as it is on the remote right after fetching it, never whatever branch the main checkout is on.
 * The local branch name when it is exactly the remote's commit, else the remote-tracking ref (local is behind,
 * ahead or diverged). A remote that can't be fetched is an error, never a silent stale start. A repository with
 * no remote starts from its local default branch (or the current one).
 */
export async function pickupBase(cwd: string, wanted?: string): Promise<{ ref: string; commit: string }> {
  const name = wanted?.trim() || undefined
  if (name?.startsWith('-')) throw new Error(`Not a valid base: "${name}"`)
  const sha = async (ref: string): Promise<string | null> => {
    const r = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd)
    return r.code === 0 ? r.stdout.trim() : null
  }
  const remotes = (await git(['remote'], cwd)).stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  if (remote) {
    const f = await git(['fetch', '--quiet', '--prune', remote], cwd, 60000)
    if (f.code !== 0) throw new Error(`Couldn't fetch ${remote}, so it didn't start from a possibly stale ${name ?? 'base'}: ${(f.stderr.trim().split('\n').pop() || `git fetch exited ${f.code}`).trim()}`)
    let branch = name
    if (!branch) {
      const head = (await git(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], cwd)).stdout.trim()
      if (head.startsWith(`${remote}/`)) branch = head.slice(remote.length + 1)
      else for (const b of ['main', 'master']) if (!branch && (await sha(`refs/remotes/${remote}/${b}`))) branch = b
    }
    const up = branch ? await sha(`refs/remotes/${remote}/${branch}`) : null
    if (branch && up) return { ref: (await sha(`refs/heads/${branch}`)) === up ? branch : `${remote}/${branch}`, commit: up }
    if (name && !(await sha(`refs/heads/${name}`))) throw new Error(`There is no branch ${name} on ${remote} or here to start from`)
  }
  // no remote, or the remote doesn't have it: the local branch
  let local = name
  if (!local) for (const b of ['main', 'master']) if (!local && (await sha(`refs/heads/${b}`))) local = b
  local ??= await currentRef(cwd)
  const commit = await sha(local)
  if (!commit) throw new Error(`There is no ${local} to start from`)
  return { ref: local, commit }
}

/** A pull request goes into a branch on GitHub: "origin/master" (work started from the upstream) is "master" there. */
async function prBase(cwd: string, base: string): Promise<string> {
  const slash = base.indexOf('/')
  if (slash < 0 || (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${base}`], cwd)).code === 0) return base
  return (await git(['rev-parse', '--verify', '--quiet', `refs/remotes/${base}`], cwd)).code === 0 ? base.slice(slash + 1) : base
}

export interface AddWorktreeOptions {
  /** check out this branch, which must exist, instead of creating one; `base` is only recorded (what "ahead" counts from) */
  existing?: boolean
  /** a branch typed by hand: taken as written (no sldev/ prefix), and an error rather than -2 when it is taken */
  exact?: boolean
}

/**
 * Create an isolated worktree next to the repo: ../.sldev-worktrees/<repo>/<folder>, for missions and
 * by hand from the Git view. For missions, `name` is the branch: "feature/dark-mode" as it is, or a
 * bare slug, which goes under sldev/ as before, and both branch and folder get -2, -3… when taken.
 * The folder is the name with its slashes turned into dashes. `base` '' is the current branch.
 */
export async function addWorktree(root: string, name: string, base: string, opts: AddWorktreeOptions = {}): Promise<WorktreeInfo> {
  const top = (await ok(['rev-parse', '--show-toplevel'], root)).trim()
  if (base.trim().startsWith('-')) throw new Error(`Not a valid base: "${base}"`)
  // record a name or commit as the base, never "HEAD", which moves on
  const start = base.trim() || (await currentRef(top))
  const byHand = !!(opts.existing || opts.exact)
  const wanted = byHand ? await checkBranchName(top, name) : name.includes('/') ? name : `sldev/${name}`
  const taken = await branchExists(top, wanted)
  if (opts.existing && !taken) throw new Error(`There is no branch "${wanted}"`)
  if (opts.exact && !opts.existing && taken) throw new Error(`A branch "${wanted}" already exists. Pick it as an existing branch, or choose another name.`)
  const dir = join(dirname(top), '.sldev-worktrees', basename(top))
  mkdirSync(dir, { recursive: true })
  const folder = (byHand ? wanted : name).replace(/\//g, '-')
  let path = join(dir, folder)
  let branch = wanted
  for (let i = 2; existsSync(path) || (!byHand && (await branchExists(top, branch))); i++) {
    path = join(dir, `${folder}-${i}`)
    if (!byHand) branch = `${wanted}-${i}`
  }
  if (opts.existing) await ok(['worktree', 'add', path, branch], top)
  else await ok(['worktree', 'add', '-b', branch, path, start], top)
  return { path, branch, base: start, repo: top }
}

/** Drop git's records of worktrees whose folders are gone. Their branches stay. */
export async function pruneWorktrees(cwd: string): Promise<void> {
  await ok(['worktree', 'prune'], cwd)
}

/** What removing a worktree would lose: uncommitted files, and commits only its branch has. */
export async function worktreeStatus(wt: WorktreeInfo): Promise<WorktreeStatus> {
  if (!existsSync(wt.path)) return { exists: false, modified: 0, untracked: 0, unmerged: 0 }
  const lines = (await git(['status', '--porcelain', '--untracked-files=all'], wt.path)).stdout.split('\n').filter(Boolean)
  const untracked = lines.filter((l) => l.startsWith('??')).length
  const ahead = await git(['rev-list', '--count', `${wt.base}..${wt.branch}`], wt.repo)
  return { exists: true, modified: lines.length - untracked, untracked, unmerged: ahead.code === 0 ? Number(ahead.stdout.trim()) || 0 : 0 }
}

/**
 * Remove a mission's worktree. Without `discard`, git refuses when the folder has uncommitted or
 * untracked files, so work is never thrown away unless the user acknowledged exactly that.
 */
export async function removeWorktree(wt: WorktreeInfo, opts: { deleteBranch: boolean; discard: boolean }): Promise<void> {
  if (existsSync(wt.path)) await ok(['worktree', 'remove', ...(opts.discard ? ['--force'] : []), wt.path], wt.repo)
  else await git(['worktree', 'prune'], wt.repo)
  if (opts.deleteBranch) await ok(['branch', '-D', wt.branch], wt.repo)
}

/** Unified diff of everything that changed since `base` (committed, staged, unstaged and untracked). */
export async function diff(cwd: string, base: string): Promise<string> {
  const mergeBase = (await git(['merge-base', base, 'HEAD'], cwd)).stdout.trim() || base
  const tracked = await ok(['diff', '--no-color', '--no-ext-diff', mergeBase], cwd)
  const untracked = (await git(['ls-files', '--others', '--exclude-standard'], cwd)).stdout.split('\n').filter(Boolean).slice(0, 100)
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const parts = await Promise.all(untracked.map((f) => git(['diff', '--no-color', '--no-index', '--', nul, f], cwd).then((r) => r.stdout)))
  return tracked + parts.join('')
}

/** A file as it was at the mission's base (the merge base, like diff), or '' if it didn't exist there. */
export async function baseVersion(cwd: string, base: string, path: string): Promise<string> {
  const mergeBase = (await git(['merge-base', base, 'HEAD'], cwd)).stdout.trim() || base
  const r = await git(['show', `${mergeBase}:${path}`], cwd)
  return r.code === 0 ? r.stdout : ''
}

/** The files a branch changed since it left `base` (committed, uncommitted and new), for the board's "shares files" flag. */
export async function changedFiles(cwd: string, base: string): Promise<string[]> {
  if (!base || base.startsWith('-')) throw new Error(`Not a valid base: "${base}"`)
  const mergeBase = (await git(['merge-base', base, 'HEAD'], cwd)).stdout.trim() || base
  const [tracked, untracked] = await Promise.all([git(['diff', '--name-only', '--no-renames', mergeBase, '--'], cwd), git(['ls-files', '--others', '--exclude-standard'], cwd)])
  if (tracked.code !== 0) throw new Error(tracked.stderr.trim() || 'git diff failed')
  return [...new Set([...tracked.stdout.split('\n'), ...untracked.stdout.split('\n')].filter(Boolean))].sort()
}

export async function diffStat(cwd: string, base: string): Promise<DiffStat> {
  const mergeBase = (await git(['merge-base', base, 'HEAD'], cwd)).stdout.trim() || base
  const r = await git(['diff', '--shortstat', mergeBase], cwd)
  const untracked = (await git(['ls-files', '--others', '--exclude-standard'], cwd)).stdout.split('\n').filter(Boolean)
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const added = await Promise.all(
    untracked.slice(0, 100).map((f) => git(['diff', '--numstat', '--no-index', '--', nul, f], cwd).then((x) => Number(x.stdout.split('\t')[0]) || 0))
  )
  const n = (re: RegExp): number => Number(re.exec(r.stdout)?.[1] ?? 0)
  return { files: n(/(\d+) files? changed/) + untracked.length, insertions: n(/(\d+) insertions?/) + added.reduce((a, b) => a + b, 0), deletions: n(/(\d+) deletions?/) }
}

export async function commitAll(cwd: string, message: string): Promise<string> {
  // nothing to commit is not an error
  if (!(await ok(['status', '--porcelain'], cwd)).trim()) return ''
  await ok(['add', '-A'], cwd)
  return ok(['commit', '-m', message], cwd)
}

/**
 * Merge `branch` into `into` in the main checkout, locally (no PR). The checkout must already be on `into`:
 * merging into whatever happens to be checked out there is how a branch ends up somewhere unexpected.
 */
export async function merge(repo: string, branch: string, into?: string): Promise<string> {
  if (into) {
    const on = await gitBranch(repo)
    if (on !== into) throw new Error(`The main checkout (${repo}) is on ${on || 'a detached HEAD'}, not ${into}. Switch it to ${into} first, or merge through the pull request.`)
  }
  const r = await git(['merge', '--no-ff', '--no-edit', branch], repo)
  if (r.code === 0) return (r.stdout + r.stderr).trim()
  const out = (r.stderr + '\n' + r.stdout).trim()
  // a conflict leaves the checkout mid-merge; say how to get out, not just git's wall of text
  if (/CONFLICT|Automatic merge failed/.test(out)) {
    await git(['merge', '--abort'], repo)
    throw new Error(`${branch} conflicts with ${into ?? 'the checked-out branch'}; the merge was undone. Resolve it in the worktree (merge ${into ?? 'the base'} into it), or through the pull request.`)
  }
  if (/would be overwritten/.test(out)) throw new Error(`The main checkout has uncommitted changes in files this branch touches. Commit or stash them there first, or merge through the pull request.\n\n${out}`)
  throw new Error(out || 'git merge failed')
}

export async function pushAndCreatePr(cwd: string, branch: string, base: string, title: string, body?: string): Promise<string> {
  await ok(['push', '-u', 'origin', branch], cwd)
  const r = await run('gh', ['pr', 'create', '--head', branch, '--base', await prBase(cwd, base), '--title', title, ...(body ? ['--body', body] : ['--fill'])], cwd, 60000)
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'gh pr create failed')
  return r.stdout.trim().split('\n').pop() ?? ''
}

/** Pushes new commits to a branch that already has a pull request. */
export async function push(cwd: string, branch: string): Promise<void> {
  await ok(['push', 'origin', branch], cwd)
}

const SKIP_DIRS = ['node_modules', 'dist', 'build', 'out', 'vendor', 'coverage', '.next', 'target', '__pycache__']

/**
 * Where names are used in the checkout, for the review's blast radius: `git grep -w` over tracked and
 * untracked (not ignored) files, local only. Capped (names, output, time) so a huge repo can't stall the
 * review; `capped` says the list is cut short.
 */
export function uses(cwd: string, names: string[]): Promise<{ uses: Use[]; capped: boolean }> {
  const words = [...new Set(names.filter((n) => /^[A-Za-z_$][\w$]{2,80}$/.test(n)))].slice(0, 25)
  if (!words.length) return Promise.resolve({ uses: [], capped: false })
  const args = ['grep', '-z', '-n', '-I', '-w', '-F', '--untracked', '--no-color', ...words.flatMap((w) => ['-e', w]), '--', '.', ...SKIP_DIRS.map((d) => `:(exclude,glob)**/${d}/**`)]
  const MAX = 2000
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 8000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout) => {
      const e = err as { code?: string | number; killed?: boolean } | null
      // 1 is "nothing found"; a timeout or too much output keeps what came so far
      const cut = !!e && (e.killed || e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
      if (e && !cut && e.code !== 1) return resolve({ uses: [], capped: false })
      const found = parseGrep(String(stdout ?? ''), MAX)
      resolve({ uses: found, capped: cut || found.length >= MAX })
    })
  })
}

export async function listFiles(cwd: string): Promise<string[]> {
  const r = await git(['ls-files', '--cached', '--others', '--exclude-standard'], cwd)
  return r.code === 0 ? r.stdout.split('\n').filter(Boolean).slice(0, 50000) : []
}

/**
 * Commits on HEAD since midnight of day `from` (YYYY-MM-DD, local time), for the activity charts: exactly
 * what `git log --since` lists. A repository without commits has none, which isn't an error.
 */
export async function activityCommits(cwd: string, from: string): Promise<ActivityCommit[]> {
  const r = await git(['log', `--since=${sinceArg(from)}`, `--format=${COMMIT_LOG_FORMAT}`], cwd, 60000)
  if (r.code !== 0) {
    if (/does not have any commits|bad default revision/i.test(r.stderr)) return []
    throw new Error(r.stderr.trim() || 'git log failed')
  }
  return parseCommitLog(r.stdout)
}

/**
 * The last `limit` commits of every branch, tag and remote, children before parents, for the commit graph.
 * One more than asked is read to know whether there are more.
 */
export async function graphLog(cwd: string, limit = 300): Promise<GraphLog> {
  const n = Math.max(1, Math.min(Math.floor(limit), 20000))
  const [log, remotes, origin] = await Promise.all([
    git(['log', '--all', '--topo-order', '--no-color', `--max-count=${n + 1}`, `--format=${GRAPH_LOG_FORMAT}`], cwd),
    git(['remote'], cwd),
    git(['remote', 'get-url', 'origin'], cwd)
  ])
  // a repo without commits has nothing to draw, which isn't an error
  if (log.code !== 0 && !/does not have any commits|unknown revision/.test(log.stderr)) throw new Error(log.stderr.trim() || 'git log failed')
  const commits = parseGraphLog(log.code === 0 ? log.stdout : '', remotes.stdout.split('\n').filter(Boolean))
  return { commits: commits.slice(0, n), more: commits.length > n, githubUrl: origin.code === 0 ? githubWebUrl(origin.stdout) : null }
}

/** One commit's own changes, as a unified diff (a merge against its first parent). */
export async function showCommit(cwd: string, sha: string): Promise<string> {
  if (!/^[0-9a-f]{7,64}$/.test(sha)) throw new Error(`Not a commit: "${sha}"`)
  return ok(['show', '--no-color', '--no-ext-diff', '--format=', '--first-parent', '-m', sha], cwd)
}

/** when each remote was last fetched for the ship bar, so a Review tab polling every 15 s doesn't fetch every time */
const lastFetch = new Map<string, number>()
const FETCH_EVERY_MS = 5 * 60_000

/**
 * How far the base moved since the branch in `cwd` left it, before anything is pushed: the commits on the base
 * that HEAD doesn't have, and a trial merge (`git merge-tree --write-tree`, git 2.38+) that names the files that
 * would conflict without touching the worktree, the index or any ref. The base is compared as it is on its
 * upstream when the local branch is only behind it (fetched at most every 5 minutes).
 */
export async function baseMoved(cwd: string, base: string): Promise<BaseMoved> {
  if (!base || base.startsWith('-')) throw new Error(`Not a valid base: "${base}"`)
  const remote = (await git(['config', '--get', `branch.${base}.remote`], cwd)).stdout.trim()
  if (remote && remote !== '.') {
    const key = `${(await git(['rev-parse', '--git-common-dir'], cwd)).stdout.trim()}\0${remote}`
    if (Date.now() - (lastFetch.get(key) ?? 0) > FETCH_EVERY_MS) {
      lastFetch.set(key, Date.now())
      await git(['fetch', '--quiet', '--prune', remote], cwd, 60000)
    }
  }
  const ref = await upstreamIfBehind(cwd, base)
  const [count, log] = await Promise.all([
    git(['rev-list', '--count', `HEAD..${ref}`, '--'], cwd),
    git(['log', '--no-color', '--max-count=50', '--format=%H%x00%s', `HEAD..${ref}`, '--'], cwd)
  ])
  if (log.code !== 0 || count.code !== 0) throw new Error((log.stderr || count.stderr).trim() || `git log HEAD..${ref} failed`)
  const commits = log.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, subject = ''] = l.split('\0')
      return { sha, subject }
    })
  const behind = Number(count.stdout.trim()) || commits.length
  return { base, ref, behind, commits, conflicts: behind ? await trialMerge(cwd, ref) : [] }
}

/** `base`'s upstream when the local branch only lags it (no fetch here), else `base` itself */
async function upstreamIfBehind(cwd: string, base: string): Promise<string> {
  const upstream = (await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${base}@{upstream}`], cwd)).stdout.trim()
  if (!upstream) return base
  const [local, up] = await Promise.all([git(['rev-parse', base], cwd), git(['rev-parse', upstream], cwd)])
  if (local.code !== 0 || up.code !== 0 || local.stdout.trim() === up.stdout.trim()) return base
  return (await git(['merge-base', '--is-ancestor', base, upstream], cwd)).code === 0 ? upstream : base
}

/** Files that would conflict merging `ref` into HEAD, computed in memory; null when this git can't tell (before 2.38). */
export async function trialMerge(cwd: string, ref: string): Promise<string[] | null> {
  const r = await git(['merge-tree', '--write-tree', '--name-only', '--no-messages', ref, 'HEAD'], cwd)
  // 0: clean, 1: conflicts; anything else (an old git without --write-tree) says nothing either way
  if (r.code === 0) return []
  if (r.code !== 1) return null
  // the first line is the tree git would write; the conflicted files follow
  return [...new Set(r.stdout.split('\n').slice(1).filter(Boolean))]
}

/**
 * Merge `ref` (the base) into the branch checked out in the worktree `cwd`, for the ship bar's Update and check.
 * Refused while tracked files have uncommitted changes. A conflict is undone (`merge --abort`) and its files
 * returned, so the worktree is left exactly as it was. Nothing is pushed.
 */
export async function mergeBaseInto(cwd: string, ref: string): Promise<{ merged: boolean; conflicts: string[]; output: string }> {
  if (!ref || ref.startsWith('-')) throw new Error(`Not a valid base: "${ref}"`)
  const dirty = (await ok(['status', '--porcelain', '--untracked-files=no'], cwd)).split('\n').filter(Boolean)
  if (dirty.length) throw new Error(`${dirty.length} changed file${dirty.length === 1 ? '' : 's'} not committed in the worktree. Commit them first, then update.`)
  const r = await git(['merge', '--no-ff', '--no-edit', ref], cwd, 120000)
  const output = (r.stdout + r.stderr).trim()
  if (r.code === 0) return { merged: true, conflicts: [], output }
  if (/CONFLICT|Automatic merge failed/.test(output)) {
    const files = (await git(['diff', '--name-only', '--diff-filter=U'], cwd)).stdout.split('\n').filter(Boolean)
    await git(['merge', '--abort'], cwd)
    return { merged: false, conflicts: files, output }
  }
  throw new Error(output || 'git merge failed')
}

/** The main checkout of the repository `cwd` belongs to (also from inside one of its worktrees). */
async function mainCheckout(cwd: string): Promise<string> {
  const main = (await listWorktrees(cwd)).find((w) => w.isMain && !w.bare)
  return main?.path ?? (await ok(['rev-parse', '--show-toplevel'], cwd)).trim()
}

const prWorktreePath = (top: string, n: number): string => join(dirname(top), '.sldev-worktrees', basename(top), prFolder(n))

/**
 * Check out the head of pull request `n` for review: fetch `pull/<n>/head` from `remote` (GitHub serves it for
 * every PR, forks included) into refs/sldev/pr/<n>, outside the user's branches, then a detached worktree at
 * ../.sldev-worktrees/<repo>/pr-<n>. Asked again at the same commit, the worktree is reused; when the PR has new
 * commits, it is moved to them (not when files were changed there). `headSha` (gh's headRefOid from the list) is
 * only compared: the fetched head is what GitHub has now, and `listedOther` says the list was out of date. Nothing is pushed, and the main checkout is never touched.
 */
export async function prWorktree(root: string, n: number, headSha?: string, remote = 'origin'): Promise<PrWorktree> {
  checkPrNumber(n)
  if (!remote || remote.startsWith('-')) throw new Error(`Not a remote: "${remote}"`)
  const top = await mainCheckout(root)
  const ref = prRef(n)
  const f = await git(['fetch', '--quiet', '--no-tags', remote, `+refs/pull/${n}/head:${ref}`], top, 120000)
  if (f.code !== 0) {
    const why = f.stderr.trim().split('\n').pop() || 'git fetch failed'
    throw new Error(/couldn't find remote ref/i.test(why) ? `${remote} has no pull request #${n}.` : `Couldn't fetch PR #${n} from ${remote}: ${why}`)
  }
  const sha = (await ok(['rev-parse', '--verify', `${ref}^{commit}`], top)).trim()
  // the list the user picked from can be older than a push or a force push: what GitHub serves now wins
  const listedOther = !!headSha && !sha.startsWith(headSha)
  const path = prWorktreePath(top, n)
  let existing = (await listWorktrees(top)).find((w) => w.path === path)
  if (existing?.prunable || (existing && !existsSync(path))) {
    await git(['worktree', 'prune'], top)
    existing = undefined
  }
  if (!existing && existsSync(path)) throw new Error(`${path} already exists and isn't a worktree of this repository. Move it away, then check out PR #${n} again.`)
  const dirty = existing ? (await ok(['status', '--porcelain', '--untracked-files=no'], path)).split('\n').filter(Boolean).length : 0
  const plan = planPrWorktree(existing ? { head: existing.head, branch: existing.branch, dirty } : null, sha, n)
  if (plan.do === 'refuse') throw new Error(plan.reason)
  if (plan.do === 'create') {
    mkdirSync(dirname(path), { recursive: true })
    await ok(['worktree', 'add', '--detach', path, sha], top)
    return { number: n, path, head: sha, repo: top, action: 'created', listedOther }
  }
  if (plan.do === 'move') await ok(['checkout', '--quiet', '--detach', sha], path)
  return { number: n, path, head: sha, repo: top, action: plan.do === 'move' ? 'moved' : 'reused', listedOther }
}

/**
 * Remove PR `n`'s review worktree and its fetched ref. Without `discard`, git refuses when the folder has
 * changed or untracked files. Whether something still runs there is the caller's check, as for any worktree.
 */
export async function removePrWorktree(root: string, n: number, opts: { discard: boolean } = { discard: false }): Promise<void> {
  checkPrNumber(n)
  const top = await mainCheckout(root)
  const path = prWorktreePath(top, n)
  const listed = (await listWorktrees(top)).some((w) => w.path === path)
  if (listed && existsSync(path)) await ok(['worktree', 'remove', ...(opts.discard ? ['--force'] : []), path], top)
  else await git(['worktree', 'prune'], top)
  await git(['update-ref', '-d', prRef(n)], top)
}
