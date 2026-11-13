/**
 * Parsers for git's porcelain output, kept pure so they are unit-tested; src/main/git.ts runs the commands.
 */
import type { GitStatus, GitWorktree } from './types'

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
