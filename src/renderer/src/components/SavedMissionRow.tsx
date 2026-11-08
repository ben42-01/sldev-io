import { useState } from 'react'
import type { SavedMission } from '@shared/types'
import { Bookmark, Rocket, Sparkles, Trash2 } from 'lucide-react'
import { launchSavedById, removeSaved, savedTitle } from '../state/savedMissions'
import { getAgent } from '../state/agents'
import { getKind } from '../state/missionKinds'
import { openNewMission } from './MissionsView'
import { confirmAction, showNotice } from './Modal'
import { TimeAgo } from './TimeAgo'

/** A mission saved for later: click to edit it in the form, Launch to start it as saved. */
export function SavedMissionRow({ saved: m }: { saved: SavedMission }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const title = savedTitle(m)
  const agents = [getAgent(m.options.agent).name, ...(m.compare ?? []).map((a) => getAgent(a).name)].join(' + ')
  const kind = getKind(m.kind)
  const drafted = m.draftedBy ? (m.draftedBy === 'agent' ? 'an agent' : getAgent(m.draftedBy).name) : null
  const launch = async (): Promise<void> => {
    setBusy(true)
    try {
      await launchSavedById(m.id)
    } catch (e) {
      void showNotice("Couldn't launch the mission", String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (): Promise<void> => {
    const ok = await confirmAction({ title: 'Delete saved mission?', message: <>“{title}” was never launched.</>, removes: ['The saved brief and its settings'], keeps: ['Everything in the project'], confirmLabel: 'Delete', danger: true })
    if (ok) removeSaved(m.id)
  }
  return (
    <div className={`mission-row saved${drafted ? ' drafted' : ''}`} data-saved={m.id} onDoubleClick={() => openNewMission({ saved: m })}>
      {drafted ? <Sparkles size={13} className="saved-icon" aria-hidden /> : <Bookmark size={13} className="saved-icon" aria-hidden />}
      <div className="mission-row-main">
        <button type="button" className="mission-title" title={`${title}: edit before launching`} onClick={() => openNewMission({ saved: m })}>{title}</button>
        <div className="mission-row-sub" title={m.brief}>
          {drafted ? `Drafted by ${drafted}` : 'Saved'} · {agents}{kind.id !== 'build' ? ` · ${kind.name}` : ''}
        </div>
      </div>
      <TimeAgo t={m.updatedAt} className="mission-time" />
      <button className="icon-btn reveal danger" title="Delete saved mission…" aria-label="Delete saved mission" onClick={() => void remove()}>
        <Trash2 size={13} />
      </button>
      <button className="btn sm" disabled={busy} title={`Launch on ${agents} now`} onClick={() => void launch()}>
        <Rocket size={12} /> {busy ? 'Launching…' : 'Launch'}
      </button>
    </div>
  )
}
