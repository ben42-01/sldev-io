import { useEffect, useRef, useState } from 'react'
import { Bot, CornerDownRight, FileDiff, GitBranch, MessagesSquare, SquareTerminal, Trash2 } from 'lucide-react'
import { missionSignal } from '@shared/status'
import { allAgents } from '../lib/agents'
import { removeMissionFlow } from '../lib/removals'
import { focusOrResume, followUpMission, getMission, reviewMission, reviewWithAgent, setHandoff, useMission } from '../state/missions'
import { getAgent, useAgents } from '../state/agents'
import { createStore, useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { showContextMenu } from './ContextMenu'
import { Modal } from './Modal'
import { StatusPill } from './StatusDot'
import { TimeAgo } from './TimeAgo'

const details = createStore<{ id: string | null }>({ id: null })

/** Brief, report and handoff of one mission, with what to do next. */
export function openMissionDetails(id: string): void {
  details.set({ id })
}

export function MissionDetailsHost(): React.JSX.Element | null {
  const id = useStore(details, (s) => s.id)
  return id ? <MissionDetails key={id} id={id} onClose={() => details.set({ id: null })} /> : null
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }): React.JSX.Element {
  return (
    <section className="detail-section">
      <div className="section-head">
        <span className="label">{title}</span>
        <i />
        {action}
      </div>
      {children}
    </section>
  )
}

function MissionDetails({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element | null {
  const m = useMission(id)
  const agents = useAgents()
  const [handoff, setDraft] = useState(m?.handoff ?? '')
  const [following, setFollowing] = useState(false)
  const [next, setNext] = useState('')
  const [nextAgent, setNextAgent] = useState(m?.options.agent ?? '')
  const [busy, setBusy] = useState(false)
  const nextRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (following) nextRef.current?.focus()
  }, [following])
  if (!m) return null
  const agent = getAgent(m.options.agent)
  const parent = m.parent && getMission(m.parent.id)
  const saveHandoff = (): void => {
    if (handoff.trim() !== (m.handoff ?? '')) setHandoff(id, handoff)
  }
  const go = async (fn: () => Promise<unknown>): Promise<void> => {
    saveHandoff()
    setBusy(true)
    try {
      await fn()
      onClose()
    } finally {
      setBusy(false)
    }
  }
  const secondOpinion = (e: React.MouseEvent): void =>
    showContextMenu(e, [
      { type: 'header', label: 'Second opinion from' },
      ...allAgents(workspace.get().customAgents)
        .filter((a) => a.id !== (m.options.agent || 'claude'))
        .map((a) => ({ label: a.name, icon: <Bot size={13} />, run: () => void go(() => reviewWithAgent(id, a.id)) }))
    ])

  return (
    <Modal
      title={m.title}
      size="lg"
      busy={busy}
      onClose={() => (saveHandoff(), onClose())}
      onSubmit={() => following && void go(() => followUpMission(id, next, nextAgent))}
      footerNote={
        <button type="button" className="btn sm danger" onClick={() => (onClose(), void removeMissionFlow(id))}>
          <Trash2 size={13} /> Remove…
        </button>
      }
      footer={
        following ? (
          <>
            <button type="button" className="btn ghost" onClick={() => setFollowing(false)}>Back</button>
            <button type="submit" className="btn primary" disabled={!next.trim() || busy}>
              <CornerDownRight size={13} /> {busy ? 'Starting…' : 'Start follow-up'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn" onClick={() => (reviewMission(id), onClose())}><FileDiff size={13} /> Review changes</button>
            <button type="button" className="btn" onClick={secondOpinion} title="Another agent reviews the changes, read-only, with this brief and handoff">
              <MessagesSquare size={13} /> Second opinion…
            </button>
            <button type="button" className="btn" onClick={() => (void focusOrResume(id), onClose())}><SquareTerminal size={13} /> Terminal</button>
            <button type="button" className="btn primary" onClick={() => setFollowing(true)} title="A new mission in the same folder, given the original task and the handoff">
              <CornerDownRight size={13} /> Follow-up
            </button>
          </>
        )
      }
    >
      <div className="detail-meta">
        <StatusPill signal={missionSignal(m.status)} />
        <span className="chip">{agent.name}</span>
        <TimeAgo t={m.updatedAt} />
        {parent && (
          <button type="button" className="link small" onClick={() => openMissionDetails(parent.id)}>
            {m.parent?.kind === 'follow-up' ? 'Follows up on' : 'Reviews'} “{parent.title}”
          </button>
        )}
      </div>
      <div className="detail-folder mono" title={m.cwd}>
        {m.worktree ? (
          <>
            <GitBranch size={12} /> {m.worktree.branch} ← {m.worktree.base} · {m.cwd}
          </>
        ) : (
          m.cwd
        )}
      </div>

      {following ? (
        <>
          <label className="field">
            <span>What next?</span>
            <textarea ref={nextRef} rows={4} value={next} placeholder="e.g. Address the review findings and add a test for the empty page" onChange={(e) => setNext(e.target.value)} />
            <span className="field-hint">The agent also gets the original task and the {m.handoff?.trim() ? 'handoff notes' : "previous agent's report"}, and works in {m.worktree ? 'the same worktree' : 'the same folder'}.</span>
          </label>
          <label className="field">
            <span>Agent</span>
            <select value={nextAgent || 'claude'} onChange={(e) => setNextAgent(e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.installed === false ? ' (not installed)' : ''}</option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <Section title="Brief">
            <div className="detail-text selectable">{m.brief ?? m.prompt}</div>
          </Section>
          {m.criteria && (
            <Section title="Acceptance criteria">
              <div className="detail-text selectable">{m.criteria}</div>
            </Section>
          )}
          <Section title="Final report">
            {m.report || m.lastMessage ? (
              <div className="detail-text report selectable">{m.report ?? m.lastMessage}</div>
            ) : (
              <p className="hint">Nothing yet. The agent's last reply appears here when it finishes a turn.</p>
            )}
          </Section>
          <label className="field">
            <span>Handoff notes</span>
            <textarea rows={3} value={handoff} placeholder="e.g. Pagination works; the empty-page case still returns 500" onChange={(e) => setDraft(e.target.value)} onBlur={saveHandoff} />
            <span className="field-hint">Optional. Follow-ups and second opinions get these instead of the agent's report.</span>
          </label>
          <details className="prompt-preview">
            <summary>Prompt sent</summary>
            <pre className="cmd-preview selectable">{m.prompt}</pre>
          </details>
        </>
      )}
    </Modal>
  )
}
