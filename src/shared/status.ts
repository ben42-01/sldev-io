import type { MissionStatus } from './types'
import type { NodeStatus, RunStatus } from './factory'

/**
 * Every state in the app maps through here to one of six tones, so a colour always means the same
 * thing: green = working, amber = needs the human, red = failed, blue = ready for review, teal = done.
 * Pulse means live activity and nothing else.
 */
export type Tone = 'working' | 'attention' | 'error' | 'review' | 'done' | 'neutral'

export interface Signal {
  tone: Tone
  label: string
  pulse: boolean
}

const sig = (tone: Tone, label: string, pulse = false): Signal => ({ tone, label, pulse })

const MISSION: Record<MissionStatus, Signal> = {
  starting: sig('working', 'Starting', true),
  working: sig('working', 'Working', true),
  'needs-input': sig('attention', 'Needs you', true),
  waiting: sig('review', 'Ready for you'),
  failed: sig('error', 'Failed'),
  ended: sig('neutral', 'Ended')
}

export const missionSignal = (s: MissionStatus): Signal => MISSION[s]

const NODE: Record<NodeStatus, Signal> = {
  pending: sig('neutral', 'Waiting'),
  running: sig('working', 'Running', true),
  approval: sig('attention', 'Needs you', true),
  done: sig('done', 'Done'),
  failed: sig('error', 'Failed')
}

export const nodeSignal = (s: NodeStatus): Signal => NODE[s]

const RUN: Record<RunStatus, Signal> = {
  running: sig('working', 'Running', true),
  paused: sig('attention', 'Paused'),
  done: sig('done', 'Done'),
  failed: sig('error', 'Failed'),
  stopped: sig('neutral', 'Stopped')
}

/** A factory run; one waiting for an approval click needs the human. */
export const runSignal = (s: RunStatus, waitingForApproval = false): Signal => (s === 'running' && waitingForApproval ? NODE.approval : RUN[s])

// Ctrl+C (SIGINT) exits: 130 on POSIX shells, STATUS_CONTROL_C_EXIT on Windows. Shown as "stopped", not failed.
const INTERRUPTED = new Set([130, 0xc000013a, -1073741510])

/** A terminal process (runtimes, tasks). */
export function processSignal(status: 'idle' | 'starting' | 'running' | 'exited' | undefined, exitCode?: number): Signal {
  if (status === 'running') return sig('working', 'Running', true)
  if (status === 'starting') return sig('neutral', 'Starting', true)
  if (status === 'exited' && exitCode !== undefined && exitCode !== 0 && !INTERRUPTED.has(exitCode)) return sig('error', `Exited with code ${exitCode}`)
  if (status === 'exited') return sig('neutral', exitCode === 0 ? 'Finished' : 'Stopped')
  return sig('neutral', 'Not running')
}

/** Drives counters, sorting and notifications: the human has to act. */
export const needsYou = (s: Signal): boolean => s.tone === 'attention' || s.tone === 'error'
