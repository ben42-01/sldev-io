import { useEffect, useState } from 'react'
import { Factory, Files, ListChecks, Network, NotebookPen, Play, Satellite, Server } from 'lucide-react'
import { whenDockReady } from '../dock/dockApi'
import { openMissionControl } from '../dock/MissionControlPanel'
import { openDiagrams } from '../dock/DiagramPanel'
import { showView, shortcutLabel, staticCommands } from '../lib/commands'
import { updateSettings, workspace, type ViewId } from '../state/workspace'
import { useStore } from '../state/store'
import { reviewFocus } from '../state/focus'
import { useViewBadges, type ViewBadge } from '../state/attention'

/** Left sidebar views; agents, skills and workflows are tabs of the right sidebar (RightPanel.tsx). */
export const VIEW_META: Array<{ id: ViewId; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'explorer', label: 'Explorer', icon: Files },
  { id: 'runtimes', label: 'Runtimes', icon: Play },
  { id: 'factory', label: 'Factory', icon: Factory },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
  { id: 'remote', label: 'Remote', icon: Server }
]

export function ActivityBar(): React.JSX.Element {
  const active = useStore(workspace, (w) => w.activeView)
  // a review tab in focus hides the sidebar without closing it: a click then shows it rather than closing it
  const shown = useStore(workspace, (w) => w.sidebarVisible)
  const focused = useStore(reviewFocus, (f) => !!f.panel)
  const visible = shown && !focused
  const cmds = staticCommands()
  const badges = useViewBadges()
  return (
    <nav className="activitybar" aria-label="Views">
      <MissionControlButton badges={badges} />
      <div className="activity-sep" role="separator" />
      {VIEW_META.map(({ id, label, icon: Icon }) => {
        const key = shortcutLabel(cmds.find((c) => c.id === `view.${id}`)!)
        const on = active === id && visible
        const b = badges[id]
        const name = b?.label ? `${label}: ${b.label}` : label
        return (
          <button
            key={id}
            className={`activity-btn${on ? ' active' : ''}`}
            title={`${name}${key ? ` (${key})` : ''}`}
            aria-label={name}
            aria-current={on ? 'page' : undefined}
            onClick={() => (on ? updateSettings({ sidebarVisible: false }) : showView(id))}
          >
            <Icon size={20} />
            {b?.count ? (
              <span className={`count-bubble tone-${b.tone}`}>{b.count > 99 ? '99+' : b.count}</span>
            ) : b?.live ? (
              <span className="live-dot sdot small pulse tone-working" />
            ) : null}
          </button>
        )
      })}
      <div className="activity-sep" role="separator" />
      <PanelButton panelId="diagrams" label="Diagrams" title="Diagrams (code map and database schema)" icon={Network} onClick={() => openDiagrams()} />
    </nav>
  )
}

/** Lit while its panel is the active tab. */
function useActivePanel(id: string): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let sub: { dispose: () => void } | undefined
    const stop = whenDockReady((api) => {
      sub?.dispose()
      const check = (): void => setOn(api.activePanel?.id === id)
      check()
      sub = api.onDidActivePanelChange(check)
    })
    return () => (stop(), sub?.dispose())
  }, [id])
  return on
}

/** A main-area panel opened from the bar (not a sidebar view). */
function PanelButton({ panelId, label, title, icon: Icon, onClick }: { panelId: string; label: string; title: string; icon: React.ComponentType<{ size?: number }>; onClick: () => void }): React.JSX.Element {
  const on = useActivePanel(panelId)
  return (
    <button className={`activity-btn${on ? ' active' : ''}`} title={title} aria-label={label} aria-current={on ? 'page' : undefined} onClick={onClick}>
      <Icon size={20} />
    </button>
  )
}

/** Mission Control lives in the main area, not the sidebar: the button opens or focuses its tab. */
function MissionControlButton({ badges }: { badges: Partial<Record<string, ViewBadge>> }): React.JSX.Element {
  const on = useActivePanel('mission-board')
  // what needs you comes first: a mission waiting, then a factory run waiting for approval
  const b = badges.agents?.count ? badges.agents : badges.factory?.count ? badges.factory : (badges.agents ?? badges.factory)
  const name = b?.label ? `Mission Control: ${b.label}` : 'Mission Control'
  return (
    <button
      className={`activity-btn${on ? ' active' : ''}`}
      title={`${name} (missions, factory runs, usage)`}
      aria-label={name}
      aria-current={on ? 'page' : undefined}
      onClick={() => openMissionControl()}
    >
      <Satellite size={20} />
      {b?.count ? (
        <span className={`count-bubble tone-${b.tone}`}>{b.count > 99 ? '99+' : b.count}</span>
      ) : b?.live ? (
        <span className="live-dot sdot small pulse tone-working" />
      ) : null}
    </button>
  )
}
