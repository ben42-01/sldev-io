import type { RepeatPlan, RepeatProgress } from '@shared/repeat'
import type { Mission, MissionStatus } from '@shared/types'

/**
 * The daemon speaks newline-delimited JSON over a Unix socket. A client sends `{ id, cmd, args }` and
 * gets `{ id, ok, result | error }` back; an `attach` connection then also receives `{ event, … }` lines.
 */

/** A pane is a mission (the same shape the app stores, so the sldev MCP tools answer it unchanged) plus its process. */
export interface PaneInfo extends Mission {
  agentName: string
  pid?: number
  exitCode?: number
  /** agents to continue on, in order, when this one hits its usage limit */
  failover?: string[]
  /** a plain shell tab, not an agent: no mission status, no MCP tools, and it closes when the shell exits */
  shell?: boolean
}

/** The tabs of the attached TUI, kept by the daemon so detaching and attaching again restores them. */
export interface TabState {
  /** pane ids in tab order */
  order: string[]
  active: string | null
  split: boolean
}

export interface NewPaneArgs {
  agent?: string
  /** a plain shell ($SHELL, the default shell on Windows) instead of an agent; brief and the agent options are ignored */
  shell?: boolean
  brief: string
  title?: string
  kind?: string
  /** acceptance criteria, one "- " line each; they go into the kind's prompt, so they need a kind other than freeform */
  criteria?: string
  /** a branch or slug: the agent runs in a new git worktree; false: in place even when the kind would isolate it */
  worktree?: string | false
  cwd: string
  model?: string
  mode?: string
  effort?: string
  failover?: string[]
  /** print mode: the agent does the task and exits (no questions), so its exit means it's done */
  print?: boolean
  /** run the brief pass after pass (src/shared/repeat.ts); implies print unless the plan waits for `sldev accept` */
  repeat?: RepeatPlan
  cols?: number
  rows?: number
}

/** A repeat loop: its plan, its passes so far and one line saying where it is. */
export interface LoopInfo {
  id: string
  name: string
  brief: string
  plan: RepeatPlan
  progress: RepeatProgress
  label: string
  stopping?: boolean
}

/** What `sldev wait` waits for: the states a human cares about, not the internal mission statuses. */
export type WaitFor = 'ready' | 'needs-you' | 'done' | 'idle'

export const WAIT_STATES: Record<WaitFor, MissionStatus[]> = {
  ready: ['waiting'],
  'needs-you': ['needs-input'],
  done: ['ended', 'failed'],
  idle: ['waiting', 'needs-input', 'ended', 'failed']
}

export interface Requests {
  ping: [Record<string, never>, { version: string; pid: number }]
  ls: [Record<string, never>, PaneInfo[]]
  new: [NewPaneArgs, PaneInfo]
  send: [{ pane: string; text: string; enter?: boolean }, null]
  read: [{ pane: string; lines?: number }, { text: string }]
  wait: [{ pane?: string; for: WaitFor; timeout?: number }, PaneInfo | null]
  kill: [{ pane: string }, null]
  review: [{ pane: string; agent: string }, PaneInfo]
  /** a pass that waits for you is good: its agent stops and the loop moves on */
  accept: [{ pane: string }, null]
  loops: [Record<string, never>, LoopInfo[]]
  /** no pass after the running one */
  'loop-stop': [{ loop: string }, LoopInfo]
  /** every pane, in tab order */
  attach: [{ cols: number; rows: number }, PaneInfo[]]
  /** reads the tab state, and sets the fields given (an order is only taken as a reordering of the live panes) */
  tabs: [Partial<TabState>, TabState]
  rename: [{ pane: string; title: string }, PaneInfo]
  input: [{ pane: string; data: string }, null]
  resize: [{ pane: string; cols: number; rows: number }, null]
  /** the TUI says which pane it shows, so the daemon doesn't send a desktop notification for it */
  focus: [{ pane: string | null }, null]
  screen: [{ pane: string }, { data: string }]
  stop: [Record<string, never>, null]
}

export type Command = keyof Requests

export interface Request<C extends Command = Command> {
  id: number
  cmd: C
  args: Requests[C][0]
}

export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }

export type DaemonEvent =
  | { event: 'output'; pane: string; data: string }
  | { event: 'pane'; pane: PaneInfo }
  | { event: 'closed'; pane: string }
  | { event: 'notify'; pane: string; title: string; body: string }
  | { event: 'loop'; loop: LoopInfo }

/** Splits a byte stream into JSON lines; malformed lines are dropped. */
export function lineReader(onMessage: (m: unknown) => void): (chunk: Buffer | string) => void {
  let buf = ''
  return (chunk) => {
    buf += chunk.toString()
    let at: number
    while ((at = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, at)
      buf = buf.slice(at + 1)
      if (!line.trim()) continue
      try {
        onMessage(JSON.parse(line))
      } catch {
        // not JSON: ignore
      }
    }
  }
}
