import type { GitStatus } from '@shared/types'
import { createStore } from './store'
import { refreshBranch, workspace } from './workspace'
import { fetchOutcome, gitErrorLine, pullOutcome } from '../lib/git'
import { toast } from '../components/Toast'

/**
 * The Git view's state: status of the open folder, and Fetch / Pull (fast-forward only), shared by the
 * view and the command palette. Nothing here commits, merges or pushes.
 */

export type GitAction = 'fetch' | 'pull'

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
  /** git's whole message when the last fetch or pull failed; cleared by the next success */
  actionError: { action: GitAction; message: string } | null
}

export const gitState = createStore<GitState>({ root: null, repo: null, status: null, loading: false, error: '', busy: null, actionError: null })

const errText = (e: unknown): string => String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')

/** Read the status again (on focus, after every action). Results for a folder that is no longer open are dropped. */
export async function refreshGit(): Promise<void> {
  const root = workspace.get().rootFolder
  if (gitState.get().root !== root) gitState.set({ root, repo: null, status: null, error: '', actionError: null })
  if (!root) return
  gitState.set({ loading: true })
  try {
    const repo = await window.api.git.isRepo(root)
    const status = repo ? await window.api.git.status(root) : null
    if (workspace.get().rootFolder !== root) return
    gitState.set({ repo, status, error: '', loading: false })
  } catch (e) {
    if (workspace.get().rootFolder !== root) return
    gitState.set({ error: errText(e), loading: false })
  }
}

async function act(action: GitAction): Promise<void> {
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
