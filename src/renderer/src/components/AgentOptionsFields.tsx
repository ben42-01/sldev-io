import { useId } from 'react'
import type { AgentOptions } from '@shared/types'
import { applyProfile } from '@shared/profiles'
import { useAgents } from '../state/agents'
import { useProfiles } from '../state/profiles'
import { openSettings } from '../lib/commands'

/**
 * Agent picker plus model / effort / mode / print / extra-args fields, shared by the task and mission forms.
 * `part` splits them: 'who' is profile and agent, 'how' the rest (the mission form folds 'how' away).
 */
export function AgentOptionsFields({ value, onChange, showPrint = true, part }: { value: AgentOptions; onChange: (p: Partial<AgentOptions>) => void; showPrint?: boolean; part?: 'who' | 'how' }): React.JSX.Element {
  const agents = useAgents()
  const profiles = useProfiles()
  const profile = profiles.find((p) => p.id === value.profile)
  const listId = useId()
  const agent = agents.find((a) => a.id === (value.agent || 'claude')) ?? agents[0]
  // options that only make sense for the previous agent are dropped on switch
  const pick = (id: string): void => onChange({ agent: id, model: undefined, permissionMode: undefined, effort: undefined })

  const groups: [string, typeof profiles][] = [
    ['This project', profiles.filter((p) => p.scope === 'project')],
    ['Your profiles', profiles.filter((p) => p.scope === 'user')],
    ['Starters', profiles.filter((p) => p.scope === 'builtin')]
  ]

  const who = (
    <>
      <div className="field-row">
      <label className="field">
        <span>Agent</span>
        <select value={agent.id} onChange={(e) => pick(e.target.value)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.installed === false ? ' (not installed)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Profile</span>
        <select value={profile?.id ?? ''} onChange={(e) => onChange(applyProfile(value, profiles.find((p) => p.id === e.target.value)))}>
          <option value="">None: just the agent</option>
          {groups.filter(([, list]) => list.length).map(([label, list]) => (
            <optgroup key={label} label={label}>
              {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      </div>
      {profile?.description && <div className="hint">{profile.description}</div>}
      {agent.installed === false && (
        <div className="hint">
          <code>{agent.bin}</code> isn't on your PATH.
          {agent.install && (
            <>
              {' '}
              Install: <code className="selectable">{agent.install}</code>
            </>
          )}
        </div>
      )}
    </>
  )
  const how = (
    <>
      <div className="field-row">
        <label className="field">
          <span>Model</span>
          <input list={listId} value={value.model ?? ''} placeholder={agent.modelPlaceholder ?? 'default'} onChange={(e) => onChange({ model: e.target.value || undefined })} />
          <datalist id={listId}>
            {agent.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        {agent.efforts.length > 0 && (
          <label className="field">
            <span>Effort</span>
            <select value={value.effort ?? ''} onChange={(e) => onChange({ effort: e.target.value || undefined })}>
              {['', ...agent.efforts].map((m) => (
                <option key={m} value={m}>
                  {m || 'default'}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {agent.modes.length > 0 && (
        <label className="field">
          <span>Approval mode</span>
          <select value={value.permissionMode ?? ''} onChange={(e) => onChange({ permissionMode: e.target.value || undefined })}>
            <option value="">default</option>
            {agent.modes.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {showPrint && agent.canPrint && (
        <label className="check">
          <input type="checkbox" checked={!!value.print} onChange={(e) => onChange({ print: e.target.checked || undefined })} />
          <span>Non-interactive (print result and exit)</span>
        </label>
      )}
      <label className="field">
        <span>Extra arguments</span>
        <input className="mono" value={value.extraArgs ?? ''} placeholder="flags passed as-is" onChange={(e) => onChange({ extraArgs: e.target.value || undefined })} />
      </label>
      <div className="hint">
        Missing an agent?{' '}
        <span className="link" onClick={openSettings}>
          Add a custom one in Settings
        </span>
      </div>
    </>
  )
  if (part === 'who') return who
  if (part === 'how') return how
  return (
    <>
      {who}
      {how}
    </>
  )
}
