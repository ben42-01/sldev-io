import type { Task } from '@shared/types'
import { openTerminal, focusPanel } from '../dock/dockApi'
import { restartTerminal } from '../lib/terminals'
import { agentCommand } from '../lib/agents'
import { getAgent } from './agents'
import { roleFor } from './profiles'
import { startMission } from './missions'
import { findRun, isActive } from './runs'
import { createStore } from './store'
import { workspace } from './workspace'

export const tasks = createStore<{ list: Task[]; loaded: boolean }>({ list: [], loaded: false })

export async function loadTasks(): Promise<void> {
  const store = await window.api.store.get('tasks')
  tasks.set({ list: (store?.tasks ?? []).map(migrateTask), loaded: true })
}

/** Tasks saved before agents were pluggable were `kind: 'claude'` with options under `claude`. */
function migrateTask(t: Task): Task {
  const legacy = t as Omit<Task, 'kind'> & { kind: string; claude?: Task['agent'] }
  if (legacy.kind !== 'claude') return t
  const { claude, ...rest } = legacy
  return { ...rest, kind: 'agent', agent: { ...claude, agent: 'claude' } }
}

function persist(list: Task[]): void {
  tasks.set({ list })
  void window.api.store.set('tasks', { tasks: list })
}

export function saveTask(task: Task): void {
  const list = tasks.get().list
  persist(list.some((t) => t.id === task.id) ? list.map((t) => (t.id === task.id ? task : t)) : [...list, task])
}

export function deleteTask(id: string): void {
  persist(tasks.get().list.filter((t) => t.id !== id))
}

export function newTaskId(): string {
  return `task-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** The command line a task runs. Shown live in the editor so there's no magic. */
export function buildTaskCommand(task: Task): string {
  if (task.kind === 'shell') return task.command?.trim() ?? ''
  const o = task.agent ?? {}
  return agentCommand(getAgent(o.agent), o, task.prompt, task.name, { role: roleFor(o) })
}

export function taskCwd(task: Task): string | undefined {
  const base = task.scope ?? undefined
  if (!task.cwd) return base
  if (/^([/\\]|[A-Za-z]:)/.test(task.cwd) || !base) return task.cwd
  return `${base}${base.includes('\\') ? '\\' : '/'}${task.cwd}`
}

export function runTask(task: Task): void {
  const command = buildTaskCommand(task)
  if (!command) return
  saveTask({ ...task, lastRunAt: Date.now() })
  const root = task.scope ?? workspace.get().rootFolder
  if (task.kind === 'agent' && root) {
    // agent tasks run as missions: tracked status, notifications, optional worktree, diff review
    void startMission({ prompt: task.prompt ?? '', title: task.name, root, cwd: taskCwd(task) ?? root, options: task.agent ?? {}, worktree: !!task.agent?.worktree, taskId: task.id })
    return
  }
  const run = findRun('taskId', task.id)
  // a finished run of the same task is reused; a running one is just focused
  if (run && focusPanel(run.panelId)) {
    if (!isActive(run)) restartTerminal(run.panelId, command)
    return
  }
  openTerminal({ cwd: taskCwd(task) ?? workspace.get().rootFolder ?? undefined, title: task.name, command, taskId: task.id })
}
