import { execFile } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { basename, dirname, join } from 'path'
import { parseRemoteBranches, parseStatus, parseWorktrees } from '@shared/git'
import type { DiffStat, GitStatus, GitWorktree, WorktreeInfo, WorktreeStatus } from '@shared/types'

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

export async function isRepo(cwd: string): Promise<boolean> {
  return (await git(['rev-parse', '--is-inside-work-tree'], cwd)).stdout.trim() === 'true'
}

export async function branches(cwd: string): Promise<string[]> {
  const r = await git(['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads'], cwd)
  return r.code === 0 ? r.stdout.split('\n').filter(Boolean) : []
}

export async function switchBranch(cwd: string, branch: string): Promise<void> {
  await ok(['switch', branch], cwd)
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
  const branch = name.trim()
  // a leading dash would be read as an option by the commands below
  if (!branch || branch.startsWith('-')) throw new Error(`Not a valid branch name: "${name}"`)
  if (base.startsWith('-')) throw new Error(`Not a valid base: "${base}"`)
  const check = await git(['check-ref-format', '--branch', branch], cwd)
  // check-ref-format expands "@{-1}" and the like into another branch's name; only take names as written
  if (check.code !== 0 || check.stdout.trim() !== branch) throw new Error(`Not a valid branch name: "${name}"`)
  const start = base.trim() ? [base.trim()] : []
  if (switchTo) await ok(['switch', '--no-track', '-c', branch, ...start], cwd)
  else await ok(['branch', '--no-track', branch, ...start], cwd)
  return branch
}

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

/** Create an isolated worktree for a mission next to the repo: ../.sldev-worktrees/<repo>/<slug> */
/**
 * `name` is the branch: "feature/dark-mode" as it is, or a bare slug, which goes under sldev/ as before.
 * The folder is the name with its slashes turned into dashes; both get -2, -3… when taken.
 */
export async function addWorktree(root: string, name: string, base: string): Promise<WorktreeInfo> {
  const top = (await ok(['rev-parse', '--show-toplevel'], root)).trim()
  const dir = join(dirname(top), '.sldev-worktrees', basename(top))
  mkdirSync(dir, { recursive: true })
  const wanted = name.includes('/') ? name : `sldev/${name}`
  const folder = name.replace(/\//g, '-')
  let path = join(dir, folder)
  let branch = wanted
  for (let i = 2; existsSync(path) || (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], top)).code === 0; i++) {
    path = join(dir, `${folder}-${i}`)
    branch = `${wanted}-${i}`
  }
  await ok(['worktree', 'add', '-b', branch, path, base], top)
  return { path, branch, base, repo: top }
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

export async function merge(repo: string, branch: string): Promise<string> {
  return ok(['merge', '--no-ff', '--no-edit', branch], repo)
}

export async function pushAndCreatePr(cwd: string, branch: string, base: string, title: string, body?: string): Promise<string> {
  await ok(['push', '-u', 'origin', branch], cwd)
  const r = await run('gh', ['pr', 'create', '--head', branch, '--base', base, '--title', title, ...(body ? ['--body', body] : ['--fill'])], cwd, 60000)
  if (r.code !== 0) throw new Error(r.stderr.trim() || 'gh pr create failed')
  return r.stdout.trim().split('\n').pop() ?? ''
}

/** Pushes new commits to a branch that already has a pull request. */
export async function push(cwd: string, branch: string): Promise<void> {
  await ok(['push', 'origin', branch], cwd)
}

export async function listFiles(cwd: string): Promise<string[]> {
  const r = await git(['ls-files', '--cached', '--others', '--exclude-standard'], cwd)
  return r.code === 0 ? r.stdout.split('\n').filter(Boolean).slice(0, 50000) : []
}
