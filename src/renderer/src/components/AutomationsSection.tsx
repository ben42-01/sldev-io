import { useEffect, useState } from 'react'
import { Clock, Play, Plus, Trash2 } from 'lucide-react'
import { describeTrigger, type Action, type Automation, type Trigger } from '@shared/automations'
import { fire, newAutomationId, removeAutomation, saveAutomation, setEnabled, useAutomations } from '../state/automations'
import { factory } from '../state/factory'
import { useKinds } from '../state/missionKinds'
import { useAgents } from '../state/agents'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { confirmAction } from './Modal'
import { TimeAgo } from './TimeAgo'

/** Automations for the open repository: what starts on its own, and when. */
export function AutomationsSection({ root }: { root: string }): React.JSX.Element {
  const list = useAutomations().filter((a) => a.root === root)
  const [editing, setEditing] = useState<Automation | null>(null)
  return (
    <>
      <div className="section-label pad automations-head">
        <span>Automations</span>
        <button className="icon-btn" title="New automation" aria-label="New automation" onClick={() => setEditing(blank(root))}>
          <Plus size={13} />
        </button>
      </div>
      {editing && <AutomationForm initial={editing} onDone={() => setEditing(null)} />}
      {list.map((a) => <AutomationRow key={a.id} a={a} onEdit={() => setEditing(a)} />)}
      {!list.length && !editing && (
        <div className="muted-note">
          Start a recipe or a mission on its own: every weekday morning, when CI fails, or when an issue gets a label. Automations run
          while sldev-io is open and never push; a pull request still waits for your click.
        </div>
      )}
    </>
  )
}

const blank = (root: string): Automation => ({
  id: '',
  name: '',
  root,
  enabled: true,
  trigger: { type: 'schedule', every: 'weekdays', at: '09:00' },
  action: { type: 'recipe', recipe: 'Fix CI', intent: '' },
  createdAt: 0
})

function AutomationRow({ a, onEdit }: { a: Automation; onEdit: () => void }): React.JSX.Element {
  const remove = async (): Promise<void> => {
    const ok = await confirmAction({
      title: 'Remove this automation?',
      message: a.name,
      removes: ['The automation'],
      keeps: ['The runs and missions it started'],
      confirmLabel: 'Remove',
      danger: true
    })
    if (ok) removeAutomation(a.id)
  }
  return (
    <div className={`automation-row${a.enabled ? '' : ' off'}`}>
      <div className="automation-main" onClick={onEdit} title="Edit">
        <div className="automation-name">{a.name}</div>
        <div className="automation-when">
          <Clock size={11} /> {describeTrigger(a.trigger)} · {a.action.type === 'recipe' ? a.action.recipe : 'mission'}
        </div>
        {a.lastNote && <div className="automation-note">{a.lastNote}</div>}
        {!a.lastNote && a.lastCheckAt && <div className="automation-note">Checked <TimeAgo t={a.lastCheckAt} /></div>}
      </div>
      <label className="switch" title={a.enabled ? 'On' : 'Off'}>
        <input type="checkbox" aria-label={`${a.name} on`} checked={a.enabled} onChange={(e) => setEnabled(a.id, e.target.checked)} />
      </label>
      <button className="icon-btn" title="Run now" aria-label="Run now" onClick={() => void fire(a.id, undefined)}>
        <Play size={13} />
      </button>
      <button className="icon-btn danger" title="Remove" aria-label="Remove" onClick={() => void remove()}>
        <Trash2 size={13} />
      </button>
    </div>
  )
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function AutomationForm({ initial, onDone }: { initial: Automation; onDone: () => void }): React.JSX.Element {
  const [name, setName] = useState(initial.name)
  const [trigger, setTrigger] = useState<Trigger>(initial.trigger)
  const [action, setAction] = useState<Action>(initial.action)
  const recipes = useStore(factory, (s) => s.recipes)
  const kinds = useKinds()
  const agents = useAgents()
  const [branch, setBranch] = useState('')
  useEffect(() => void window.api.git.branch(initial.root).then((b) => setBranch(b ?? 'main')), [initial.root])

  const pickTrigger = (type: Trigger['type']): void =>
    setTrigger(type === 'schedule' ? { type, every: 'weekdays', at: '09:00' } : type === 'ci-failed' ? { type, branch: branch || 'main' } : { type, label: 'sldev' })
  const pickAction = (type: Action['type']): void =>
    setAction(type === 'recipe' ? { type, recipe: recipes[0]?.recipe.name ?? 'Fix CI', intent: '' } : { type, kind: 'review', brief: '' })
  const text = action.type === 'recipe' ? action.intent : action.brief
  const needsText = trigger.type === 'schedule'
  const valid = name.trim() && (!needsText || text.trim()) && (trigger.type !== 'ci-failed' || trigger.branch.trim()) && (trigger.type !== 'issue-label' || trigger.label.trim())

  const save = (): void => {
    if (!valid) return
    const isNew = !initial.id
    // a changed trigger starts from now, so it doesn't act on what happened before
    const fresh = isNew || JSON.stringify(trigger) !== JSON.stringify(initial.trigger)
    saveAutomation({ ...initial, id: initial.id || newAutomationId(), name: name.trim(), trigger, action, ...(fresh ? { createdAt: Date.now(), lastRunAt: undefined, lastCheckAt: undefined, seen: undefined } : {}) })
    onDone()
  }

  return (
    <form className="form inline-form automation-form" onSubmit={(e) => (e.preventDefault(), save())} onKeyDown={(e) => e.key === 'Escape' && onDone()}>
      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} placeholder="e.g. Morning review" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span>When</span>
        <div className="seg sm" role="radiogroup" aria-label="When">
          {(
            [
              ['schedule', 'On a schedule'],
              ['ci-failed', 'CI fails'],
              ['issue-label', 'Issue labelled']
            ] as const
          ).map(([t, label]) => (
            <button key={t} type="button" role="radio" aria-checked={trigger.type === t} className={trigger.type === t ? 'on' : ''} onClick={() => pickTrigger(t)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {trigger.type === 'schedule' && (
        <div className="field-row">
          <label className="field">
            <span>Every</span>
            <select value={trigger.every} onChange={(e) => setTrigger({ ...trigger, every: e.target.value as typeof trigger.every })}>
              <option value="hour">Hour</option>
              <option value="day">Day</option>
              <option value="weekdays">Weekday</option>
              <option value="week">Week</option>
            </select>
          </label>
          {trigger.every === 'week' && (
            <label className="field">
              <span>On</span>
              <select value={trigger.day ?? 1} onChange={(e) => setTrigger({ ...trigger, day: Number(e.target.value) })}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </label>
          )}
          <label className="field">
            <span>{trigger.every === 'hour' ? 'At minute' : 'At'}</span>
            <input type="time" value={trigger.at} onChange={(e) => setTrigger({ ...trigger, at: e.target.value })} />
          </label>
        </div>
      )}
      {trigger.type === 'ci-failed' && (
        <label className="field">
          <span>Branch</span>
          <input value={trigger.branch} onChange={(e) => setTrigger({ ...trigger, branch: e.target.value })} />
          <span className="field-hint">Checked every 5 minutes through the GitHub CLI. The newest failure gets one run; the run branches from this branch.</span>
        </label>
      )}
      {trigger.type === 'issue-label' && (
        <label className="field">
          <span>Label</span>
          <input value={trigger.label} onChange={(e) => setTrigger({ ...trigger, label: e.target.value })} />
          <span className="field-hint">Checked every 5 minutes. Each open issue with the label is handled once, one at a time; a recipe's pull request closes it.</span>
        </label>
      )}
      <div className="field">
        <span>Do</span>
        <div className="seg sm" role="radiogroup" aria-label="Do">
          <button type="button" role="radio" aria-checked={action.type === 'recipe'} className={action.type === 'recipe' ? 'on' : ''} onClick={() => pickAction('recipe')}>Run a recipe</button>
          <button type="button" role="radio" aria-checked={action.type === 'mission'} className={action.type === 'mission' ? 'on' : ''} onClick={() => pickAction('mission')}>Start a mission</button>
        </div>
      </div>
      {action.type === 'recipe' ? (
        <label className="field">
          <span>Recipe</span>
          <select value={action.recipe} onChange={(e) => setAction({ ...action, recipe: e.target.value })}>
            {recipes.map((r) => <option key={r.recipe.name} value={r.recipe.name}>{r.recipe.name}</option>)}
          </select>
        </label>
      ) : (
        <div className="field-row">
          <label className="field">
            <span>Kind</span>
            <select value={action.kind} onChange={(e) => setAction({ ...action, kind: e.target.value })}>
              {kinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Agent</span>
            <select value={action.agent ?? ''} onChange={(e) => setAction({ ...action, agent: e.target.value || undefined })}>
              <option value="">Default ({agents.find((a) => a.id === workspace.get().defaultAgent)?.name ?? 'Claude Code'})</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        </div>
      )}
      <label className="field">
        <span>{action.type === 'recipe' ? 'What should it build?' : 'Brief'}</span>
        <textarea
          rows={3}
          value={text}
          placeholder={needsText ? 'e.g. Review the commits from the last day and list risky changes' : 'Optional: added before the CI failure or the issue'}
          onChange={(e) => setAction(action.type === 'recipe' ? { ...action, intent: e.target.value } : { ...action, brief: e.target.value })}
        />
      </label>
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!valid}>{initial.id ? 'Save' : 'Create'}</button>
      </div>
    </form>
  )
}

