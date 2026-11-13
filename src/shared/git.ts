/**
 * Parsers for git's porcelain output, kept pure so they are unit-tested; src/main/git.ts runs the commands.
 */
import type { GitBranchList, GitBranchRef, GitStatus, GitWorktree } from './types'

/** `git status --porcelain=v2 --branch` (without -z): branch headers, then one line per changed path. */
export function parseStatus(out: string): GitStatus {
  const s: GitStatus = { branch: null, head: null, detached: false, upstream: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }
  for (const line of out.split('\n')) {
    if (!line) continue
    if (line.startsWith('# ')) {
      const [key, ...rest] = line.slice(2).split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') s.head = value === '(initial)' ? null : value
      else if (key === 'branch.head') {
        if (value === '(detached)') s.detached = true
        else s.branch = value
      } else if (key === 'branch.upstream') s.upstream = value
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value)
        if (m) {
          s.ahead = Number(m[1])
          s.behind = Number(m[2])
        }
      }
      continue
    }
    const kind = line[0]
    if (kind === '?') s.untracked++
    else if (kind === 'u') s.conflicted++
    else if (kind === '1' || kind === '2') {
      // "1 XY …": X is the index (staged) side, Y the working tree side; '.' means unchanged
      const xy = line.slice(2, 4)
      if (xy[0] && xy[0] !== '.') s.staged++
      if (xy[1] && xy[1] !== '.') s.unstaged++
    }
  }
  return s
}

const shortBranch = (ref: string): string => ref.replace(/^refs\/heads\//, '')

/**
 * `git worktree list --porcelain`: one block per worktree, separated by blank lines. Also takes the
 * -z form (fields ended by NUL, blocks by an empty field), which keeps paths with newlines intact.
 */
export function parseWorktrees(out: string): GitWorktree[] {
  const sep = out.includes('\0') ? '\0' : '\n'
  const list: GitWorktree[] = []
  let cur: GitWorktree | null = null
  for (const field of out.split(sep)) {
    if (!field) {
      cur = null
      continue
    }
    const space = field.indexOf(' ')
    const key = space < 0 ? field : field.slice(0, space)
    const value = space < 0 ? '' : field.slice(space + 1)
    if (key === 'worktree') {
      cur = { path: value, head: null, branch: null, detached: false, bare: false, locked: false, prunable: false, isMain: list.length === 0 }
      list.push(cur)
      continue
    }
    if (!cur) continue
    if (key === 'HEAD') cur.head = value
    else if (key === 'branch') cur.branch = shortBranch(value)
    else if (key === 'detached') cur.detached = true
    else if (key === 'bare') cur.bare = true
    else if (key === 'locked') {
      cur.locked = true
      if (value) cur.lockReason = value
    } else if (key === 'prunable') {
      cur.prunable = true
      if (value) cur.prunableReason = value
    }
  }
  return list
}

/** `git for-each-ref --format=%(refname) refs/remotes` → "origin/main", …, without the remotes' HEAD aliases. */
export function parseRemoteBranches(out: string): string[] {
  return out
    .split('\n')
    .map((l) => l.trim().replace(/^refs\/remotes\//, ''))
    .filter((l) => l && !l.endsWith('/HEAD'))
}

/** The format `parseBranchList` reads: one line per ref, fields separated by NUL (%00). */
export const BRANCH_LIST_FORMAT = ['%(refname)', '%(HEAD)', '%(committerdate:unix)', '%(upstream:short)', '%(worktreepath)', '%(contents:subject)'].join('%00')

/**
 * `git for-each-ref --sort=-committerdate --format=<BRANCH_LIST_FORMAT> refs/heads refs/remotes` → local
 * and remote branches, in git's order. `root` is this working tree, so a branch checked out here isn't
 * reported as living in another worktree. Remote HEAD aliases ("origin/HEAD") are left out.
 */
export function parseBranchList(out: string, root?: string): GitBranchList {
  const list: GitBranchList = { local: [], remote: [] }
  const same = (a: string, b?: string): boolean => !!b && a.replace(/[\\/]+$/, '') === b.replace(/[\\/]+$/, '')
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [ref = '', head = '', date = '', upstream = '', worktree = '', subject = ''] = line.split('\0')
    const local = ref.startsWith('refs/heads/')
    if (!local && !ref.startsWith('refs/remotes/')) continue
    const name = ref.replace(/^refs\/(heads|remotes)\//, '')
    if (!local && name.endsWith('/HEAD')) continue
    const current = head.trim() === '*'
    const b: GitBranchRef = {
      name,
      current,
      committedAt: Number(date) > 0 ? Number(date) * 1000 : 0,
      subject: subject.trim(),
      upstream: local && upstream ? upstream : null,
      worktree: local && worktree && !current && !same(worktree, root) ? worktree : null
    }
    ;(local ? list.local : list.remote).push(b)
  }
  return list
}

/**
 * Why `name` can't be a new branch, or null when it can. Mirrors `git check-ref-format --branch` closely
 * enough to say what is wrong under the field; main still has git check the name before creating it.
 */
export function branchNameProblem(name: string, existing: string[] = []): string | null {
  const n = name.trim()
  if (!n) return 'Enter a name, like feature/login-form.'
  if (/\s/.test(n)) return 'No spaces: use - or / instead, like fix/login-form.'
  if (n.startsWith('-')) return "Can't start with a dash."
  if (n === '@' || n === 'HEAD') return `"${n}" is reserved by git.`
  if (n.includes('..')) return 'No ".." in a name.'
  if (n.includes('@{')) return 'No "@{" in a name.'
  // eslint-disable-next-line no-control-regex
  const bad = /[~^:?*[\\\x00-\x1f\x7f]/.exec(n)
  if (bad) return bad[0] < ' ' || bad[0] === '\x7f' ? 'No control characters.' : `"${bad[0]}" isn't allowed in a branch name.`
  if (n.startsWith('/') || n.endsWith('/') || n.includes('//')) return 'Slashes separate parts: no slash at the start, the end or twice in a row.'
  if (n.endsWith('.')) return "Can't end with a dot."
  for (const part of n.split('/')) {
    if (part.startsWith('.')) return `No part can start with a dot ("${part}").`
    if (part.endsWith('.lock')) return `No part can end with ".lock" ("${part}").`
  }
  if (existing.includes(n)) return `A branch called ${n} already exists.`
  // git can't hold both a/b and a/b/c: refs are files and folders
  const clash = existing.find((e) => e.startsWith(n + '/') || n.startsWith(e + '/'))
  if (clash) return `Clashes with the branch ${clash}: a branch can't also be a folder of branches.`
  return null
}

/** How many branches a group of the Git view lists before "Show all"; older ones are a search away. */
export const BRANCH_LIMIT = 25

/**
 * What a branch group shows: with a query, the branches whose name has every word of it (any case); without,
 * the first `limit` (git lists the most recent first), plus the current branch wherever it is. `matched`
 * counts everything that fits the query, so the view can say how many are left out.
 */
export function branchSlice(list: GitBranchRef[], query: string, limit = BRANCH_LIMIT): { shown: GitBranchRef[]; matched: number } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = words.length ? list.filter((b) => words.every((w) => b.name.toLowerCase().includes(w))) : list
  const shown = matches.slice(0, limit)
  const current = matches.find((b) => b.current)
  if (current && !shown.includes(current)) shown.push(current)
  return { shown, matched: matches.length }
}
