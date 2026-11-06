import { existsSync, readFileSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import type { WorktreeInfo, WorktreeStatus } from '@shared/types'
import { gitBranch, removeWorktree, run, worktreeStatus } from '../../src/main/git'
import type { LoopInfo, PaneInfo } from './protocol'

/**
 * `sldev clean`: finished panes go from the list, and their worktrees are removed. Asked first, never with
 * --force unless --discard, and never a worktree something still uses: a live pane, a repeat loop that
 * isn't over, or (with --orphans, for worktrees no pane knows about) a mission, run or automation of the app.
 */

export interface CleanItem {
  /** the finished pane this is about; none for an orphan worktree */
  pane?: string
  title: string
  worktree?: WorktreeInfo
  status?: WorktreeStatus
  /** set when the worktree stays, and why */
  keep?: string
  /** delete its branch too (--branches, and only when no commit exists only there) */
  deleteBranch: boolean
}

export interface CleanOptions {
  /** also worktrees in .sldev-worktrees no pane knows about (from before a daemon restart) */
  orphans?: boolean
  /** remove worktrees with uncommitted files too */
  discard?: boolean
  /** delete branches whose commits are all on their base */
  branches?: boolean
  /** the project (repository root) orphans are looked for in */
  repo?: string
  /** the app's data folder: worktrees its missions, runs and automations use are never orphans */
  dataDir: string
}

const LIVE = new Set(['starting', 'working', 'waiting', 'needs-input'])
const norm = (p: string): string => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))

/** The app's own records, as text: a worktree whose path appears in them belongs to the app. */
function appMentions(dataDir: string): string {
  return ['missions.json', 'factory-runs.json', 'automations.json']
    .map((f) => {
      try {
        return readFileSync(join(dataDir, f), 'utf8')
      } catch {
        return ''
      }
    })
    .join('\n')
}

const mentioned = (text: string, path: string): boolean => {
  const escaped = JSON.stringify(path).slice(1, -1)
  return text.includes(escaped) || (process.platform === 'win32' && text.toLowerCase().includes(escaped.toLowerCase()))
}

/** sldev worktrees of `repo` (git worktree list), the ones in its .sldev-worktrees folder. */
async function sldevWorktrees(repo: string): Promise<WorktreeInfo[]> {
  const top = (await run('git', ['rev-parse', '--show-toplevel'], repo)).stdout.trim()
  if (!top) return []
  const root = resolve(top)
  const dir = norm(join(dirname(root), '.sldev-worktrees', basename(root)))
  const base = (await gitBranch(root)) || 'HEAD'
  const out = (await run('git', ['worktree', 'list', '--porcelain'], root)).stdout
  const list: WorktreeInfo[] = []
  for (const block of out.split(/\n\n+/)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1]
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1]
    if (path && branch && norm(path).startsWith(dir)) list.push({ path: resolve(path), branch, base, repo: root })
  }
  return list
}

export async function planClean(panes: PaneInfo[], loops: LoopInfo[], o: CleanOptions): Promise<CleanItem[]> {
  const busy = new Map<string, string>()
  for (const p of panes) if (LIVE.has(p.status)) busy.set(norm(p.cwd), `pane ${p.id} still works there`)
  const running = new Set(loops.filter((l) => l.progress.state !== 'finished').map((l) => l.id))
  for (const p of panes) if (p.repeat && running.has(p.repeat.loop)) busy.set(norm(p.cwd), `its repeat loop ${p.repeat.loop} isn't over`)

  const items: CleanItem[] = []
  const seen = new Set<string>()
  const add = async (pane: string | undefined, title: string, wt: WorktreeInfo | undefined): Promise<void> => {
    if (!wt) return void items.push({ pane, title, deleteBranch: false })
    const key = norm(wt.path)
    // panes that shared one worktree (failover, a repeat's passes) list it once
    if (seen.has(key)) return void items.push({ pane, title, deleteBranch: false })
    seen.add(key)
    const status = await worktreeStatus(wt)
    const dirty = status.modified + status.untracked
    const keep = busy.get(key) ?? (dirty && !o.discard ? `${dirty} uncommitted file${dirty === 1 ? '' : 's'} (--discard throws them away)` : undefined)
    items.push({ pane, title, worktree: wt, status, keep, deleteBranch: !!o.branches && !keep && status.unmerged === 0 })
  }

  for (const p of panes) {
    if (LIVE.has(p.status)) continue
    if (p.repeat && running.has(p.repeat.loop)) continue
    await add(p.id, p.title, p.worktree)
  }
  if (o.orphans && o.repo) {
    const app = appMentions(o.dataDir)
    const known = new Set(panes.flatMap((p) => (p.worktree ? [norm(p.worktree.path)] : [])))
    for (const wt of await sldevWorktrees(o.repo)) {
      if (known.has(norm(wt.path)) || mentioned(app, wt.path)) continue
      await add(undefined, `worktree ${wt.branch}`, wt)
    }
  }
  return items
}

/** The plan in lines: what goes, what stays and why. */
export function describeClean(items: CleanItem[]): string[] {
  return items.map((i) => {
    const who = i.pane ? `pane ${i.pane} ${i.title}` : i.title
    if (!i.worktree) return `  remove ${who} from the list`
    const commits = i.status?.unmerged ? `; ${i.status.unmerged} commit${i.status.unmerged === 1 ? '' : 's'} only on ${i.worktree.branch}` : ''
    if (i.keep) return `  keep   ${who}: ${i.worktree.path} (${i.keep})`
    const branch = i.deleteBranch ? `, and its branch ${i.worktree.branch}` : `; branch ${i.worktree.branch} stays${commits}`
    return `  remove ${who}: ${i.worktree.path}${branch}`
  })
}

/** Does the plan; returns a line per thing that went wrong (git refusing, say). */
export async function runClean(items: CleanItem[], o: CleanOptions, removePane: (id: string) => Promise<void>): Promise<string[]> {
  const problems: string[] = []
  for (const i of items) {
    if (i.worktree && !i.keep) {
      try {
        if (existsSync(i.worktree.path) || i.deleteBranch) await removeWorktree(i.worktree, { deleteBranch: i.deleteBranch, discard: !!o.discard })
      } catch (e) {
        problems.push(`${i.worktree.path}: ${(e as Error).message.split('\n')[0]}`)
        continue
      }
    }
    // a pane whose worktree stays stays listed, so it can still be opened
    if (i.pane && !i.keep) await removePane(i.pane).catch((e: Error) => problems.push(`pane ${i.pane}: ${e.message}`))
  }
  return problems
}
