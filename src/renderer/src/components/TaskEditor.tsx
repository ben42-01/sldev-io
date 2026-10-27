import { useState } from 'react'
import type { AgentOptions, Task } from '@shared/types'
import { Bot, Terminal } from 'lucide-react'
import { buildTaskCommand } from '../state/tasks'
import { commandText } from '../lib/agents'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { basename } from '../lib/paths'
import { AgentOptionsFields } from './AgentOptionsFields'
import { getAgent } from '../state/agents'

export function TaskEditor({ initial, onSave, onCancel }: { initial: Task; onSave: (t: Task, run: boolean) => void; onCancel: () => void }): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const [t, setT] = useState<Task>(initial)
  const set = (p: Partial<Task>): void => setT((x) => ({ ...x, ...p }))
  const setAgent = (p: Partial<AgentOptions>): void => setT((x) => ({ ...x, agent: { ...x.agent, ...p } }))
  const command = commandText(buildTaskCommand(t))
  const valid = !!t.name.trim() && (t.kind === 'agent' ? !!t.prompt?.trim() || !!t.agent?.extraArgs : !!t.command?.trim())

  const submit = (run: boolean): void => {
    if (valid) onSave({ ...t, name: t.name.trim(), createdAt: t.createdAt || Date.now() }, run)
  }

  return (
    <form
      className="form view-scroll"
      onSubmit={(e) => {
        e.preventDefault()
        submit(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          submit(true)
        }
        if (e.key === 'Escape') onCancel()
      }}
    >
      <div className="seg">
        <button type="button" className={t.kind === 'agent' ? 'on' : ''} aria-pressed={t.kind === 'agent'} onClick={() => set({ kind: 'agent' })}>
          <Bot size={14} /> Agent
        </button>
        <button type="button" className={t.kind === 'shell' ? 'on' : ''} aria-pressed={t.kind === 'shell'} onClick={() => set({ kind: 'shell' })}>
          <Terminal size={14} /> Shell
        </button>
      </div>

      <label className="field">
        <span>Name</span>
        <input autoFocus value={t.name} placeholder={t.kind === 'agent' ? 'Fix failing tests' : 'Build & test'} onChange={(e) => set({ name: e.target.value })} />
      </label>

      {t.kind === 'agent' ? (
        <>
          <label className="field">
            <span>Prompt</span>
            <textarea rows={6} value={t.prompt ?? ''} placeholder="Run the test suite, find the failures and fix them…" onChange={(e) => set({ prompt: e.target.value })} />
          </label>
          <AgentOptionsFields value={t.agent ?? {}} onChange={setAgent} />
          <label className="check">
            <input type="checkbox" checked={!!t.agent?.worktree} onChange={(e) => setAgent({ worktree: e.target.checked || undefined })} />
            <span>Run in a new git worktree (review & merge afterwards)</span>
          </label>
        </>
      ) : (
        <label className="field">
          <span>Command</span>
          <textarea className="mono" rows={4} value={t.command ?? ''} placeholder="npm ci && npm test" onChange={(e) => set({ command: e.target.value })} />
        </label>
      )}

      <div className="field-row">
        <label className="field">
          <span>Scope</span>
          <select value={t.scope === null ? 'global' : 'project'} onChange={(e) => set({ scope: e.target.value === 'global' ? null : root, cwd: '' })}>
            {root && <option value="project">Project: {basename(root)}</option>}
            <option value="global">Global</option>
          </select>
        </label>
        <label className="field">
          <span>Folder</span>
          <input className="mono" value={t.cwd} placeholder={t.scope ? '(project root)' : '(current project)'} onChange={(e) => set({ cwd: e.target.value })} />
        </label>
      </div>

      <div className="field">
        <span>Runs</span>
        <pre className="cmd-preview">{command || '…'}</pre>
        {t.kind === 'agent' && <span className="hint">Runs as a {getAgent(t.agent?.agent).name} mission: live status, notifications and diff review{t.agent?.worktree ? ', in its own worktree' : ''}.</span>}
      </div>

      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn" disabled={!valid}>Save</button>
        <button type="button" className="btn primary" disabled={!valid} title="Ctrl/Cmd+Enter" onClick={() => submit(true)}>Save & run</button>
      </div>
    </form>
  )
}
