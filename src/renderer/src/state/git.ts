import type { GitBranchList, GitStatus } from '@shared/types'
import { createStore } from './store'
import { refreshBranch, workspace } from './workspace'
import { fetchOutcome, gitErrorLine, pullOutcome } from '../lib/git'
import { toast } from '../components/Toast'

/**
 * The Git view's state: status of the open folder, and Fetch / Pull (fast-forward only), shared by the
 * view and the command palette. Nothing here commits, merges or pushes.
 */

export type GitAction = 'fetch' | 'pull' | 'switch'

export interface GitState {
  /** folder the rest describes */
  root: string | null
  /** null until the first check; false: the folder is not a git repository */
  repo: boolean | null
  status: GitStatus | null
  loading: boolean
  /** reading the status failed */
  error: string
  busy: GitAction | null
  /** git's whole message when the last fetch, pull or switch failed; cleared by the next success */
  actionError: { action: GitAction; message: string; branch?: string } | null
  /** local and remote branches; null until read (or when reading them failed) */
  branches: GitBranchList | null
}

export const gitState = createStore<GitState>({ root: null, repo: null, status: null, loading: false, error: '', busy: null, actionError: null, branches: null })

const errText = (e: unknown): string => String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')

/** Read the status again (on focus, after every action). Results for a folder that is no longer open are dropped. */
export async function refreshGit(): Promise<void> {
  const root = workspace.get().rootFolder
  if (gitState.get().root !== root) gitState.set({ root, repo: null, status: null, error: '', actionError: null, branches: null })
  if (!root) return
  gitState.set({ loading: true })
  try {
    const repo = await window.api.git.isRepo(root)
    const [status, branches] = repo
      ? await Promise.all([window.api.git.status(root), window.api.git.branchList(root).catch(() => null)])
      : [null, null]
    if (workspace.get().rootFolder !== root) return
    gitState.set({ repo, status, branches, error: '', loading: false })
  } catch (e) {
    if (workspace.get().rootFolder !== root) return
    gitState.set({ error: errText(e), loading: false })
  }
}

async function act(action: 'fetch' | 'pull'): Promise<void> {
  const root = workspace.get().rootFolder
  if (!root || gitState.get().busy) return
  if (gitState.get().root !== root || gitState.get().repo === null) await refreshGit()
  if (!gitState.get().repo) {
    toast(`${root} is not a git repository`, 3200, 'error')
    return
  }
  const before = gitState.get().status
  gitState.set({ busy: action })
  try {
    const out = action === 'fetch' ? await window.api.git.fetch(root) : await window.api.git.pull(root)
    await refreshGit()
    gitState.set({ actionError: null })
    toast(action === 'fetch' ? fetchOutcome(gitState.get().status) : pullOutcome(out, before?.behind ?? 0, before?.upstream ?? null))
  } catch (e) {
    const message = errText(e)
    await refreshGit()
    gitState.set({ actionError: { action, message } })
    toast(`${action === 'fetch' ? 'Fetch' : 'Pull'} failed: ${gitErrorLine(message)}`, 5000, 'error')
  } finally {
    gitState.set({ busy: null })
    if (action === 'pull') void refreshBranch()
  }
}

export const gitFetch = (): Promise<void> => act('fetch')
export const gitPull = (): Promise<void> => act('pull')

/**
 * Check out a local branch. Main refuses while tracked files have uncommitted changes (and git refuses
 * whatever else it won't do), so a failure leaves everything as it was; git's message goes in the view.
 */
export async function gitSwitch(branch: string): Promise<boolean> {
  const root = workspace.get().rootFolder
  if (!root || gitState.get().busy) return false
  gitState.set({ busy: 'switch' })
  try {
    await window.api.git.switch(root, branch)
    await refreshGit()
    gitState.set({ actionError: null })
    toast(`Switched to ${branch}`)
    return true
  } catch (e) {
    const message = errText(e)
    await refreshGit()
    gitState.set({ actionError: { action: 'switch', message, branch } })
    toast(`Couldn't switch to ${branch}: ${gitErrorLine(message)}`, 5000, 'error')
    return false
  } finally {
    gitState.set({ busy: null })
    void refreshBranch()
  }
}

/**
 * Create `name` at `base` ('' = the current HEAD) and check it out when `switchTo`. Resolves with git's
 * message when it failed (the dialog shows it and stays open), or null when the branch exists.
 */
export async function gitCreateBranch(name: string, base: string, switchTo: boolean): Promise<string | null> {
  const root = workspace.get().rootFolder
  if (!root) return 'No folder is open'
  try {
    const branch = await window.api.git.createBranch(root, name, base, switchTo)
    await refreshGit()
    gitState.set({ actionError: null })
    toast(switchTo ? `Created and switched to ${branch}` : `Created ${branch}`)
    if (switchTo) void refreshBranch()
    return null
  } catch (e) {
    await refreshGit()
    return errText(e)
  }
}
