import { Bot, Factory, Files, ListChecks, NotebookPen, Play, Server, Sparkles, Workflow } from 'lucide-react'
import { showView, shortcutLabel, staticCommands } from '../lib/commands'
import { updateSettings, workspace, type ViewId } from '../state/workspace'
import { useStore } from '../state/store'

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
  return (
    <nav className="activitybar">
      {VIEW_META.map(({ id, label, icon: Icon }) => {
        const key = shortcutLabel(cmds.find((c) => c.id === `view.${id}`)!)
        return (
          <button
            key={id}
            className={`activity-btn${active === id && visible ? ' active' : ''}`}
            title={`${label}${key ? ` (${key})` : ''}`}
            onClick={() => (active === id && visible ? updateSettings({ sidebarVisible: false }) : showView(id))}
          >
            <Icon size={20} />
          </button>
        )
      })}
    </nav>
  )
}
