import { useEffect, useState } from 'react'
import type { AgentOptions, RuntimeDef, Task } from '@shared/types'
import { Bot, FolderOpen, Terminal } from 'lucide-react'
import { buildTaskCommand, taskCwd } from '../state/tasks'
import { commandText } from '../lib/agents'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { basename, relative } from '../lib/paths'
import { AgentOptionsFields } from './AgentOptionsFields'
import { getAgent } from '../state/agents'

export function TaskEditor({ initial, onSave, onCancel }: { initial: Task; onSave: (t: Task, run: boolean) => void; onCancel: () => void }): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const [t, setT] = useState<Task>(initial)
  const set = (p: Partial<Task>): void => setT((x) => ({ ...x, ...p }))
  const setAgent = (p: Partial<AgentOptions>): void => setT((x) => ({ ...x, agent: { ...x.agent, ...p } }))
  const command = commandText(buildTaskCommand(t))
  // inside the project the folder is kept relative, so the task still works if the project moves
  const browse = async (): Promise<void> => {
    const base = t.scope ?? root ?? undefined
    const dir = await window.api.fs.pickFolder(taskCwd(t) ?? base)
    if (dir) set({ cwd: t.scope ? (relative(t.scope, dir) === '.' ? '' : relative(t.scope, dir)) : dir })
  }
  // scripts in the task's folder (package.json, Makefile, …) to pick from; re-read when the folder changes
  const folder = taskCwd(t) ?? root ?? undefined
  const [scripts, setScripts] = useState<RuntimeDef[]>([])
  useEffect(() => {
    setScripts([])
    if (t.kind !== 'shell' || !folder || !/^([/\\]|[A-Za-z]:)/.test(folder)) return
    let live = true
    const timer = setTimeout(() => void window.api.runtimes.scripts(folder).then((r) => live && setScripts(r), () => undefined), 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [folder, t.kind])
  const groups = [...new Set(scripts.map((r) => r.group))]
  const picked = scripts.find((r) => r.command === t.command?.trim())
  const pick = (id: string): void => {
    const r = scripts.find((x) => x.id === id)
    if (r) set({ command: r.command, name: t.name.trim() ? t.name : r.name })
  }

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
        <>
          {scripts.length > 0 && (
            <label className="field">
              <span>Script</span>
              <select value={picked?.id ?? ''} onChange={(e) => pick(e.target.value)}>
                <option value="">{picked ? '' : `Pick a script from ${basename(folder ?? '')}…`}</option>
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {scripts
                      .filter((r) => r.group === g)
                      .map((r) => (
                        <option key={r.id} value={r.id} title={r.detail}>
                          {r.name}
                          {r.detail ? `  ·  ${r.detail.length > 50 ? r.detail.slice(0, 49) + '…' : r.detail}` : ''}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <span className="field-hint">Fills in the command below; change the folder to pick from another package.</span>
            </label>
          )}
          <label className="field">
            <span>Command</span>
            <textarea className="mono" rows={4} value={t.command ?? ''} placeholder="npm ci && npm test" onChange={(e) => set({ command: e.target.value })} />
          </label>
        </>
      )}

      <div className="field-row">
        <label className="field">
          <span>Scope</span>
          <select value={t.scope === null ? 'global' : 'project'} onChange={(e) => set({ scope: e.target.value === 'global' ? null : root, cwd: '' })}>
            {root && <option value="project">Project: {basename(root)}</option>}
            <option value="global">Global</option>
          </select>
        </label>
        <div className="field">
          <span>Folder</span>
          <div className="path-input">
            <input className="mono" value={t.cwd} spellCheck={false} aria-label="Folder" placeholder={t.scope ? '(project root)' : '(current project)'} onChange={(e) => set({ cwd: e.target.value })} />
            <button type="button" className="btn icon" title="Browse…" aria-label="Browse for a folder" onClick={() => void browse()}>
              <FolderOpen size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="field">
        <span>Runs</span>
        <pre className="cmd-preview">{command || '…'}</pre>
        {t.kind === 'agent' && <span className="field-hint">Runs as a {getAgent(t.agent?.agent).name} mission: live status, notifications and diff review{t.agent?.worktree ? ', in its own worktree' : ''}.</span>}
      </div>

      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn" disabled={!valid}>Save</button>
        <button type="button" className="btn primary" disabled={!valid} title="Ctrl/Cmd+Enter" onClick={() => submit(true)}>Save & run</button>
      </div>
    </form>
  )
}
