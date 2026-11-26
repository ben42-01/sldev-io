import { useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import type { AgentProfile } from '@shared/types'
import { useAgents } from '../state/agents'
import { loadProjectProfiles, useProfiles } from '../state/profiles'
import { useStore } from '../state/store'
import { updateSettings, workspace } from '../state/workspace'

const scopeLabel: Record<AgentProfile['scope'], string> = { builtin: 'starter', user: 'yours', project: 'project' }

/** Settings → Agents: the list of profiles and an editor for one of them. */
export function AgentProfiles(): React.JSX.Element {
  const profiles = useProfiles()
  const root = useStore(workspace, (w) => w.rootFolder)
  const [draft, setDraft] = useState<AgentProfile | null>(null)
  const [message, setMessage] = useState('')

  const blank = (): AgentProfile => ({ id: `user:${Date.now().toString(36)}`, name: '', description: '', role: '', scope: 'user' })
  const copyOf = (p: AgentProfile): AgentProfile => ({ ...p, id: `user:${Date.now().toString(36)}`, name: `${p.name} (copy)`, scope: 'user', path: undefined, team: undefined })
  const edit = (p: AgentProfile): void => {
    setMessage('')
    setDraft(p.scope === 'builtin' ? copyOf(p) : { ...p })
  }

  return (
    <div className="field">
      <span>Agent profiles: a CLI with fixed options plus a role. Pick one in any mission, task or skill run.</span>
      <div className="profile-list">
        {profiles.map((p) => (
          <button key={p.id} type="button" className={`profile-row${draft?.id === p.id ? ' on' : ''}`} onClick={() => edit(p)} title={p.scope === 'builtin' ? 'Starter profile: edit a copy' : 'Edit'}>
            <b>{p.name}</b>
            <span className="profile-desc">{p.description}</span>
            <span className="profile-scope">{scopeLabel[p.scope]}</span>
          </button>
        ))}
      </div>
      {!draft && (
        <button type="button" className="btn sm" onClick={() => edit(blank())}>
          <Plus size={13} /> New profile
        </button>
      )}
      {draft && <ProfileEditor key={draft.id} draft={draft} root={root} onDone={(msg) => { setDraft(null); setMessage(msg) }} onCopy={() => setDraft(copyOf(draft))} />}
      {message && <div className="hint">{message}</div>}
    </div>
  )
}

function ProfileEditor({ draft, root, onDone, onCopy }: { draft: AgentProfile; root: string | null; onDone: (message: string) => void; onCopy: () => void }): React.JSX.Element {
  const agents = useAgents()
  const userProfiles = useStore(workspace, (w) => w.agentProfiles ?? [])
  const [p, setP] = useState(draft)
  const [error, setError] = useState('')
  const set = (patch: Partial<AgentProfile>): void => setP((x) => ({ ...x, ...patch }))
  const agent = agents.find((a) => a.id === p.agent)
  const saved = p.scope === 'project' ? !!p.path : userProfiles.some((u) => u.id === p.id)

  const save = async (): Promise<void> => {
    if (!p.name.trim()) return setError('Give the profile a name.')
    if (!p.role.trim()) return setError('Write the role: what this agent does and how.')
    try {
      if (p.scope === 'project') {
        if (!root) return setError('Open a project to save project profiles.')
        await window.api.profiles.save(root, { ...p, id: '' })
        // it may have moved from your profiles to the project
        updateSettings({ agentProfiles: userProfiles.filter((u) => u.id !== p.id) })
        await loadProjectProfiles(root)
      } else {
        const others = userProfiles.filter((u) => u.id !== p.id)
        updateSettings({ agentProfiles: [...others, { ...p, path: undefined }].sort((a, b) => a.name.localeCompare(b.name)) })
      }
      onDone(`Saved ${p.name}.`)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const remove = async (): Promise<void> => {
    try {
      if (p.scope === 'project' && root && p.path) {
        await window.api.profiles.remove(root, p.path)
        await loadProjectProfiles(root)
      } else updateSettings({ agentProfiles: userProfiles.filter((u) => u.id !== p.id) })
      onDone(`Removed ${p.name}.`)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const exportTo = async (target: 'claude' | 'opencode'): Promise<void> => {
    if (!root) return setError('Open a project to export into it.')
    try {
      const path = await window.api.profiles.export(root, p, target)
      setError('')
      onDone(`Exported to ${path}`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="custom-agent profile-editor">
      <div className="field-row">
        <label className="field">
          <span>Name</span>
          <input value={p.name} placeholder="Reviewer" onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>Saved in</span>
          <select value={p.scope} onChange={(e) => set({ scope: e.target.value as AgentProfile['scope'], path: undefined })} disabled={saved}>
            <option value="user">Your profiles (every project)</option>
            <option value="project" disabled={!root}>This project (.sldev/agents)</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>Description</span>
        <input value={p.description} placeholder="Reviews a diff for bugs and risks" onChange={(e) => set({ description: e.target.value })} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Agent</span>
          <select value={p.agent ?? ''} onChange={(e) => set({ agent: e.target.value || undefined, model: undefined, permissionMode: undefined, effort: undefined })}>
            <option value="">Any (whichever is picked)</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Model</span>
          <input value={p.model ?? ''} placeholder={agent?.modelPlaceholder ?? 'default'} onChange={(e) => set({ model: e.target.value || undefined })} />
        </label>
      </div>
      {agent && (agent.modes.length > 0 || agent.efforts.length > 0) && (
        <div className="field-row">
          {agent.modes.length > 0 && (
            <label className="field">
              <span>Approval mode</span>
              <select value={p.permissionMode ?? ''} onChange={(e) => set({ permissionMode: e.target.value || undefined })}>
                <option value="">default</option>
                {agent.modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </label>
          )}
          {agent.efforts.length > 0 && (
            <label className="field">
              <span>Effort</span>
              <select value={p.effort ?? ''} onChange={(e) => set({ effort: e.target.value || undefined })}>
                {['', ...agent.efforts].map((m) => <option key={m} value={m}>{m || 'default'}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      <label className="field">
        <span>Role (Markdown). Claude Code gets it as a system prompt; other agents get it at the top of the prompt.</span>
        <textarea className="mono" rows={8} value={p.role} placeholder="You review changes; you never edit files. …" onChange={(e) => set({ role: e.target.value })} />
      </label>
      {error && <div className="bad">{error}</div>}
      <div className="profile-actions">
        <button type="button" className="btn sm primary" onClick={() => void save()}>Save</button>
        <button type="button" className="btn sm" onClick={() => onDone('')}>Cancel</button>
        <span className="grow" />
        {saved && (
          <>
            <button type="button" className="btn sm" title="Write .claude/agents/<name>.md in this project" onClick={() => void exportTo('claude')}>Export as Claude subagent</button>
            <button type="button" className="btn sm" title="Write .opencode/agent/<name>.md in this project" onClick={() => void exportTo('opencode')}>Export to OpenCode</button>
            <button type="button" className="icon-btn" title="Duplicate" aria-label="Duplicate" onClick={onCopy}><Copy size={13} /></button>
            <button type="button" className="icon-btn" title="Delete" aria-label="Delete" onClick={() => void remove()}><Trash2 size={13} /></button>
          </>
        )}
      </div>
    </div>
  )
}
