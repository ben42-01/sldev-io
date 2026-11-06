import { useEffect, useState } from 'react'
import { Clock, Play, Plus, Repeat, Trash2 } from 'lucide-react'
import { describeTrigger, type Action, type Automation, type Trigger } from '@shared/automations'
import { progressLabel } from '@shared/repeat'
import { passSignal } from '@shared/status'
import { fire, newAutomationId, removeAutomation, saveAutomation, setEnabled, useAutomations } from '../state/automations'
import { factory } from '../state/factory'
import { useKinds } from '../state/missionKinds'
import { useAgents } from '../state/agents'
import { createStore, useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { showView } from '../lib/commands'
import { focusOrResume } from '../state/missions'
import { confirmAction } from './Modal'
import { StatusDot } from './StatusDot'
import { TimeAgo } from './TimeAgo'

/** an automation to open in the form, filled in from a mission or a task ("Repeat…") */
const draftStore = createStore<{ draft: Automation | null }>({ draft: null })

/** Opens the Factory view with a repeat of this brief in the automation form, to adjust and create. */
export function openRepeatDraft(d: { root: string; name: string; brief: string; kind?: string; agent?: string }): void {
  draftStore.set({
    draft: {
      ...blank(d.root),
      name: d.name.slice(0, 60),
      trigger: { ...REPEAT_DEFAULT },
      action: { type: 'mission', kind: d.kind && d.kind !== 'freeform' ? d.kind : 'build', brief: d.brief, agent: d.agent }
    }
  })
  showView('factory')
}

const REPEAT_DEFAULT: Extract<Trigger, { type: 'repeat' }> = { type: 'repeat', times: 3, gapMinutes: 0, doneWhen: 'exit' }

const clock = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** Automations for the open repository: what starts on its own, and when. */
export function AutomationsSection({ root }: { root: string }): React.JSX.Element {
  const list = useAutomations().filter((a) => a.root === root)
  const [editing, setEditing] = useState<Automation | null>(null)
  const draft = useStore(draftStore, (s) => s.draft)
  useEffect(() => {
    if (!draft || draft.root !== root) return
    setEditing(draft)
    draftStore.set({ draft: null })
  }, [draft, root])
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
          Start a recipe or a mission on its own: every weekday morning, when CI fails, when an issue gets a label, or the same mission
          again and again, each pass building on the last. Automations run
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
  const repeat = a.trigger.type === 'repeat' ? a.trigger : undefined
  return (
    <div className={`automation-row${a.enabled ? '' : ' off'}`}>
      <div className="automation-main" onClick={onEdit} title="Edit">
        <div className="automation-name">{a.name}</div>
        <div className="automation-when">
          {repeat ? <Repeat size={11} /> : <Clock size={11} />} {describeTrigger(a.trigger)} · {a.action.type === 'recipe' ? a.action.recipe : 'mission'}
        </div>
        {repeat && (
          <div className="repeat-progress">
            <span className="repeat-passes" onClick={(e) => e.stopPropagation()}>
              {a.repeat?.passes.map((p) => {
                const sig = passSignal(p.outcome)
                return (
                  <button key={p.n} type="button" className="repeat-pass" title={`Pass ${p.n}: ${sig.label}. Click to show its mission`} aria-label={`Pass ${p.n}: ${sig.label}`} onClick={() => void focusOrResume(p.mission)}>
                    <StatusDot signal={sig} />
                  </button>
                )
              })}
            </span>
            <span className="repeat-label">{progressLabel(repeat, a.repeat, Date.now(), clock)}</span>
          </div>
        )}
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

  const pickTrigger = (type: Trigger['type']): void => {
    if (type === 'repeat') {
      setTrigger({ ...REPEAT_DEFAULT })
      // a repeat runs a mission: each pass is one, in the same folder
      if (action.type !== 'mission') setAction({ type: 'mission', kind: 'build', brief: action.intent })
      return
    }
    setTrigger(type === 'schedule' ? { type, every: 'weekdays', at: '09:00' } : type === 'ci-failed' ? { type, branch: branch || 'main' } : { type, label: 'sldev' })
  }
  const pickAction = (type: Action['type']): void =>
    setAction(type === 'recipe' ? { type, recipe: recipes[0]?.recipe.name ?? 'Fix CI', intent: '' } : { type, kind: 'review', brief: '' })
  const text = action.type === 'recipe' ? action.intent : action.brief
  const needsText = trigger.type === 'schedule' || trigger.type === 'repeat'
  const valid = name.trim() && (!needsText || text.trim()) && (trigger.type !== 'ci-failed' || trigger.branch.trim()) && (trigger.type !== 'issue-label' || trigger.label.trim())

  const save = (): void => {
    if (!valid) return
    const isNew = !initial.id
    // a changed trigger starts from now, so it doesn't act on what happened before
    const fresh = isNew || JSON.stringify(trigger) !== JSON.stringify(initial.trigger)
    saveAutomation({ ...initial, id: initial.id || newAutomationId(), name: name.trim(), trigger, action, ...(fresh ? { createdAt: Date.now(), lastRunAt: undefined, lastCheckAt: undefined, seen: undefined, repeat: undefined } : {}) })
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
              ['issue-label', 'Issue labelled'],
              ['repeat', 'Repeat']
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
      {trigger.type === 'repeat' && <RepeatFields trigger={trigger} onChange={setTrigger} />}
      <div className="field">
        <span>Do</span>
        <div className="seg sm" role="radiogroup" aria-label="Do">
          <button type="button" role="radio" aria-checked={action.type === 'recipe'} className={action.type === 'recipe' ? 'on' : ''} disabled={trigger.type === 'repeat'} title={trigger.type === 'repeat' ? 'A repeat runs a mission, pass after pass' : undefined} onClick={() => pickAction('recipe')}>Run a recipe</button>
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

type RepeatTrigger = Extract<Trigger, { type: 'repeat' }>

function RepeatFields({ trigger: t, onChange }: { trigger: RepeatTrigger; onChange: (t: RepeatTrigger) => void }): React.JSX.Element {
  const num = (v: string): number => Math.max(0, Number(v) || 0)
  return (
    <>
      <div className="field-row">
        <label className="field">
          <span>Passes</span>
          <input type="number" min={0} max={50} value={t.times} onChange={(e) => onChange({ ...t, times: Math.min(50, Math.round(num(e.target.value))) })} />
        </label>
        <label className="field">
          <span>Minutes between</span>
          <input type="number" min={0} step="any" value={t.gapMinutes} onChange={(e) => onChange({ ...t, gapMinutes: num(e.target.value) })} />
        </label>
      </div>
      <span className="field-hint">0 passes keeps going until a pass changes nothing. The wait starts when a pass is over, not on the clock.</span>
      <div className="field">
        <span>A pass is over when</span>
        <div className="seg sm" role="radiogroup" aria-label="A pass is over when">
          <button type="button" role="radio" aria-checked={t.doneWhen === 'exit'} className={t.doneWhen === 'exit' ? 'on' : ''} onClick={() => onChange({ ...t, doneWhen: 'exit' })}>The agent exits</button>
          <button type="button" role="radio" aria-checked={t.doneWhen === 'accept'} className={t.doneWhen === 'accept' ? 'on' : ''} onClick={() => onChange({ ...t, doneWhen: 'accept' })}>I accept it</button>
        </div>
        <span className="field-hint">
          {t.doneWhen === 'exit'
            ? 'No input needed: each pass runs in print mode, where the agent can’t stop to ask, so its exit means it’s finished. It runs with the unattended mode from Settings → Software Factory.'
            : 'Interactive: you watch and steer each pass, then click Accept pass on its mission card. Closing or stopping the mission ends the loop.'}
        </span>
      </div>
      <label className="field">
        <span>Check after each pass</span>
        <input value={t.check ?? ''} placeholder="Optional, e.g. npm run typecheck && npm test" onChange={(e) => onChange({ ...t, check: e.target.value || undefined })} />
        <span className="field-hint">Runs in the mission’s folder. A failure goes to the next pass to fix first; two in a row stop the loop.</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={!!t.keepGoingUnchanged} onChange={(e) => onChange({ ...t, keepGoingUnchanged: e.target.checked || undefined })} />
        <span>Keep going when a pass changes nothing</span>
      </label>
      <span className="field-hint">Each pass works in the same worktree and is committed on its own; the next pass gets the last one’s report. Nothing is pushed.</span>
    </>
  )
}
