import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentDef } from '@shared/agents'
import type { Mission } from '@shared/types'
import type { PaneInfo, TabState } from './protocol'

/**
 * The daemon's panes on disk (<data>/sessions.json), so a reboot, a crash or a killed daemon doesn't lose them:
 * the next daemon reopens shell tabs in their folders and resumes each agent's own session. Written a moment after
 * every change, not only on exit, because Windows ends a detached process at shutdown without a signal.
 * `sldev stop` forgets them: stopping every agent on purpose means they stay stopped.
 */

export interface SavedSessions {
  version: 1
  nextId: number
  tabs: TabState
  panes: PaneInfo[]
}

export const isLive = (s: Mission['status']): boolean => s === 'starting' || s === 'working' || s === 'waiting' || s === 'needs-input'

/** what the next daemon does with a pane it finds in the file */
export type Restore =
  | { how: 'shell' }
  /** the agent's own session: Claude's id from its hooks, or true for "continue the latest one here" */
  | { how: 'resume'; resume: string | true }
  /** listed as it was (so sldev clean still knows its worktree), with why it wasn't started again */
  | { how: 'ended'; note?: string }

/**
 * Never re-sends a prompt: an agent comes back only through its resume, so work isn't done twice. A print-mode run,
 * a pass of a repeat and an agent another agent started had nobody to talk to; resuming them interactive would
 * leave a session nobody asked for, so they're listed as stopped instead.
 */
export function restorePlan(p: PaneInfo, agent: AgentDef | undefined, exists: (dir: string) => boolean = existsSync): Restore {
  if (!isLive(p.status)) return { how: 'ended' }
  if (!exists(p.cwd)) return { how: 'ended', note: `Not reopened after sldev restarted: ${p.cwd} is gone` }
  if (p.shell) return { how: 'shell' }
  if (!agent) return { how: 'ended', note: `Not resumed after sldev restarted: the agent "${p.options.agent}" isn't known any more` }
  if (p.options.print || p.repeat || p.spawnedBy) return { how: 'ended', note: `Stopped when sldev restarted; a run without questions isn't started again (its files are as it left them)` }
  if (agent.hooks && p.sessionId) return { how: 'resume', resume: p.sessionId }
  if (!agent.hooks && agent.canResume && p.status !== 'starting') return { how: 'resume', resume: true }
  return { how: 'ended', note: `Not resumed after sldev restarted: ${agent.name} had no session to resume yet` }
}

export function readSessions(dir: string): SavedSessions | null {
  try {
    const s = JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8')) as SavedSessions
    return s?.version === 1 && Array.isArray(s.panes) ? s : null
  } catch {
    return null
  }
}

/**
 * A debounced, atomic writer (tmp + rename: a crash mid-write leaves the last good file). `end` writes the file one last time and stops, before the daemon kills its ptys: their exits aren't saved as the panes' end.
 */
export function sessionWriter(dir: string, get: () => SavedSessions): { schedule: () => void; end: () => void; forget: () => void } {
  const file = join(dir, 'sessions.json')
  let timer: NodeJS.Timeout | null = null
  let stopped = false
  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (stopped) return
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(`${file}.tmp`, JSON.stringify(get()), { mode: 0o600 })
    renameSync(`${file}.tmp`, file)
  }
  return {
    schedule: () => {
      if (stopped || timer) return
      timer = setTimeout(() => {
        try {
          flush()
        } catch {
          // a full disk or a locked file: the next change tries again
        }
      }, 300)
    },
    end: () => {
      try {
        flush()
      } catch {
        // what was written last stays
      }
      stopped = true
    },
    forget: () => {
      if (timer) clearTimeout(timer)
      timer = null
      stopped = true
      try {
        unlinkSync(file)
      } catch {
        // never written
      }
    }
  }
}
