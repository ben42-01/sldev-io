import { useState } from 'react'
import type { ClaudeTaskOptions, Task } from '@shared/types'
import { Bot, Terminal } from 'lucide-react'
import { buildTaskCommand } from '../state/tasks'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { basename } from '../lib/paths'

const MODELS = ['', 'opus', 'sonnet', 'haiku', 'fable']
const PERMISSION_MODES = ['', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'manual', 'bypassPermissions']
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max']

export function TaskEditor({ initial, onSave, onCancel }: { initial: Task; onSave: (t: Task, run: boolean) => void; onCancel: () => void }): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const [t, setT] = useState<Task>(initial)
  const set = (p: Partial<Task>): void => setT((x) => ({ ...x, ...p }))
  const setClaude = (p: Partial<ClaudeTaskOptions>): void => setT((x) => ({ ...x, claude: { ...x.claude, ...p } }))
  const command = buildTaskCommand(t)
  const valid = !!t.name.trim() && (t.kind === 'claude' ? !!t.prompt?.trim() || !!t.claude?.extraArgs : !!t.command?.trim())

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
        <button type="button" className={t.kind === 'claude' ? 'on' : ''} onClick={() => set({ kind: 'claude' })}>
          <Bot size={14} /> Claude
        </button>
        <button type="button" className={t.kind === 'shell' ? 'on' : ''} onClick={() => set({ kind: 'shell' })}>
          <Terminal size={14} /> Shell
        </button>
      </div>

      <label className="field">
        <span>Name</span>
        <input autoFocus value={t.name} placeholder={t.kind === 'claude' ? 'Fix failing tests' : 'Build & test'} onChange={(e) => set({ name: e.target.value })} />
      </label>

      {t.kind === 'claude' ? (
        <>
          <label className="field">
            <span>Prompt</span>
            <textarea rows={6} value={t.prompt ?? ''} placeholder="Run the test suite, find the failures and fix them…" onChange={(e) => set({ prompt: e.target.value })} />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Model</span>
              <select value={t.claude?.model ?? ''} onChange={(e) => setClaude({ model: e.target.value || undefined })}>
                {MODELS.map((m) => <option key={m} value={m}>{m || 'default'}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Effort</span>
              <select value={t.claude?.effort ?? ''} onChange={(e) => setClaude({ effort: e.target.value || undefined })}>
                {EFFORTS.map((m) => <option key={m} value={m}>{m || 'default'}</option>)}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Permission mode</span>
            <select value={t.claude?.permissionMode ?? ''} onChange={(e) => setClaude({ permissionMode: e.target.value || undefined })}>
              {PERMISSION_MODES.map((m) => <option key={m} value={m}>{m || 'default'}</option>)}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={!!t.claude?.worktree} onChange={(e) => setClaude({ worktree: e.target.checked || undefined })} />
            <span>Run in a fresh git worktree</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={!!t.claude?.print} onChange={(e) => setClaude({ print: e.target.checked || undefined })} />
            <span>Non-interactive (print result and exit)</span>
          </label>
          <label className="field">
            <span>Extra arguments</span>
            <input className="mono" value={t.claude?.extraArgs ?? ''} placeholder="--add-dir ../shared" onChange={(e) => setClaude({ extraArgs: e.target.value || undefined })} />
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
      </div>

      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn" disabled={!valid}>Save</button>
        <button type="button" className="btn primary" disabled={!valid} title="Ctrl/Cmd+Enter" onClick={() => submit(true)}>Save & run</button>
      </div>
    </form>
  )
}
