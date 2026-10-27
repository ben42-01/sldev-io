import { useState } from 'react'
import type { Task } from '@shared/types'
import { Bot, Copy, Pencil, Play, Plus, Square, SquareTerminal, Terminal, Trash2 } from 'lucide-react'
import { focusPanel } from '../dock/dockApi'
import { stopTerminal } from '../lib/terminals'
import { basename } from '../lib/paths'
import { isActive, useRun } from '../state/runs'
import { useStore } from '../state/store'
import { commandText } from '../lib/agents'
import { buildTaskCommand, deleteTask, newTaskId, runTask, saveTask, tasks } from '../state/tasks'
import { workspace } from '../state/workspace'
import { getAgent } from '../state/agents'
import { showContextMenu, type MenuItem } from './ContextMenu'
import { StatusDot } from './StatusDot'
import { ViewShell } from './RuntimesView'
import { TaskEditor } from './TaskEditor'

export function TasksView(): React.JSX.Element {
  const list = useStore(tasks, (t) => t.list)
  const root = useStore(workspace, (w) => w.rootFolder)
  const [editing, setEditing] = useState<Task | null>(null)

  if (editing) {
    return (
      <ViewShell title={editing.createdAt ? 'Edit task' : 'New task'}>
        <TaskEditor
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={(t, run) => {
            saveTask(t)
            setEditing(null)
            if (run) runTask(t)
          }}
        />
      </ViewShell>
    )
  }

  const blank = (): Task => ({ id: newTaskId(), name: '', scope: root, kind: 'agent', cwd: '', prompt: '', agent: { agent: workspace.get().defaultAgent }, createdAt: 0 })
  const project = root ? list.filter((t) => t.scope === root) : []
  const global = list.filter((t) => t.scope === null)

  return (
    <ViewShell
      title="Tasks"
      actions={
        <button className="icon-btn" title="New task" onClick={() => setEditing(blank())}>
          <Plus size={14} />
        </button>
      }
    >
      <div className="view-scroll">
        {root && (
          <Section label={basename(root)} tasks={project} onEdit={setEditing} empty="No tasks for this project yet." />
        )}
        <Section label="Global" tasks={global} onEdit={setEditing} empty="Global tasks show up in every project." />
        <div className="view-footer">
          <button className="btn" onClick={() => setEditing(blank())}>
            <Plus size={14} /> New task
          </button>
        </div>
      </div>
    </ViewShell>
  )
}

function Section({ label, tasks, onEdit, empty }: { label: string; tasks: Task[]; onEdit: (t: Task) => void; empty: string }): React.JSX.Element {
  return (
    <div className="task-section">
      <div className="section-label pad">{label}</div>
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} onEdit={() => onEdit(t)} />
      ))}
      {!tasks.length && <div className="muted-note">{empty}</div>}
    </div>
  )
}

function TaskRow({ task, onEdit }: { task: Task; onEdit: () => void }): React.JSX.Element {
  const run = useRun('taskId', task.id)
  const active = isActive(run)
  const subtitle = task.kind === 'agent' ? task.prompt?.split('\n')[0] || getAgent(task.agent?.agent).name : task.command
  const menu = (): MenuItem[] => [
    { label: 'Run', icon: <Play size={13} />, run: () => runTask(task) },
    { label: 'Stop', icon: <Square size={13} />, disabled: !active, run: () => run && stopTerminal(run.panelId) },
    { label: 'Show terminal', icon: <SquareTerminal size={13} />, disabled: !run, run: () => run && focusPanel(run.panelId) },
    { type: 'separator' },
    { label: 'Edit', icon: <Pencil size={13} />, run: onEdit },
    { label: 'Duplicate', icon: <Copy size={13} />, run: () => saveTask({ ...task, id: newTaskId(), name: `${task.name} (copy)`, createdAt: Date.now(), lastRunAt: undefined }) },
    { label: 'Copy command', run: () => void navigator.clipboard.writeText(commandText(buildTaskCommand(task))) },
    { type: 'separator' },
    { label: 'Delete', icon: <Trash2 size={13} />, run: () => deleteTask(task.id) }
  ]
  return (
    <div className="rt-row" onDoubleClick={() => runTask(task)} onContextMenu={(e) => showContextMenu(e, menu())} title={commandText(buildTaskCommand(task))}>
      {run ? <StatusDot run={run} /> : <span className="task-kind">{task.kind === 'agent' ? <Bot size={14} /> : <Terminal size={14} />}</span>}
      <div className="rt-main">
        <div className="rt-name">{task.name}</div>
        <div className="rt-cmd">{subtitle}</div>
        {task.lastRunAt && <div className="rt-meta">ran {timeAgo(task.lastRunAt)}</div>}
      </div>
      <div className="row-actions">
        <button className="icon-btn" title="Edit" onClick={onEdit}>
          <Pencil size={13} />
        </button>
        <button className={`icon-btn${active ? ' danger' : ' go'}`} title={active ? 'Stop' : 'Run'} onClick={() => (active && run ? stopTerminal(run.panelId) : runTask(task))}>
          {active ? <Square size={13} /> : <Play size={13} />}
        </button>
      </div>
    </div>
  )
}

function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
