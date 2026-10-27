import { Bot, Factory, Files, ListChecks, NotebookPen, Play, Server, Sparkles, Workflow } from 'lucide-react'
import { showView, shortcutLabel, staticCommands } from '../lib/commands'
import { updateSettings, workspace, type ViewId } from '../state/workspace'
import { useStore } from '../state/store'
import { useViewBadges } from '../state/attention'

export const VIEW_META: Array<{ id: ViewId; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'explorer', label: 'Explorer', icon: Files },
  { id: 'runtimes', label: 'Runtimes', icon: Play },
  { id: 'agents', label: 'Agent Missions', icon: Bot },
  { id: 'factory', label: 'Factory', icon: Factory },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'workflows', label: 'GitHub Workflows', icon: Workflow },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
  { id: 'remote', label: 'Remote', icon: Server }
]

export function ActivityBar(): React.JSX.Element {
  const active = useStore(workspace, (w) => w.activeView)
  const visible = useStore(workspace, (w) => w.sidebarVisible)
  const cmds = staticCommands()
  const badges = useViewBadges()
  return (
    <nav className="activitybar" aria-label="Views">
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
    </nav>
  )
}
