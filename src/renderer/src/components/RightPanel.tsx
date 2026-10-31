import { Bot, Brain, LayoutDashboard, PanelRightClose, Sparkles, Workflow } from 'lucide-react'
import type { RightTab } from '@shared/types'
import { shortcutLabel, showView, staticCommands } from '../lib/commands'
import { useViewBadges, type ViewBadge } from '../state/attention'
import { useStore } from '../state/store'
import { updateSettings, workspace } from '../state/workspace'
import { MissionsView } from './MissionsView'
import { OverviewView } from './OverviewView'
import { ResizeHandle } from './Sidebar'
import { SkillsView } from './SkillsView'
import { ContextView } from './ContextTab'
import { WorkflowsView } from './WorkflowsView'

const TABS: Array<{ id: RightTab; label: string; title: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'overview', label: 'Overview', title: 'Overview', icon: LayoutDashboard },
  { id: 'agents', label: 'Agents', title: 'Agent Missions', icon: Bot },
  { id: 'skills', label: 'Skills', title: 'Skills', icon: Sparkles },
  { id: 'context', label: 'Context', title: 'Project Context', icon: Brain },
  { id: 'workflows', label: 'Workflows', title: 'GitHub Workflows', icon: Workflow }
]

const tabName = (t: (typeof TABS)[number], b: ViewBadge | undefined): string => (b?.label ? `${t.title}: ${b.label}` : t.title)

function tabTitle(t: (typeof TABS)[number], b: ViewBadge | undefined): string {
  const key = shortcutLabel(staticCommands().find((c) => c.id === `view.${t.id}`)!)
  return `${tabName(t, b)}${key ? ` (${key})` : ''}`
}

function Badge({ b }: { b: ViewBadge | undefined }): React.JSX.Element | null {
  if (b?.count) return <span className={`count-bubble tone-${b.tone}`}>{b.count > 99 ? '99+' : b.count}</span>
  return b?.live ? <span className="live-dot sdot small pulse tone-working" /> : null
}

/** The right sidebar: overview, agent missions, skills, project context and workflows as tabs; a slim rail when closed. */
export function RightPanel(): React.JSX.Element {
  const visible = useStore(workspace, (w) => w.rightPanelVisible)
  const width = useStore(workspace, (w) => w.rightPanelWidth)
  const tab = useStore(workspace, (w) => w.rightPanelTab)
  const badges = useViewBadges()

  if (!visible) {
    return (
      <nav className="activitybar right" aria-label="Right sidebar">
        {TABS.map((t) => (
          <button key={t.id} className="activity-btn" title={tabTitle(t, badges[t.id])} aria-label={tabName(t, badges[t.id])} onClick={() => showView(t.id)}>
            <t.icon size={20} />
            <Badge b={badges[t.id]} />
          </button>
        ))}
      </nav>
    )
  }

  return (
    <aside className="sidebar rightpanel" style={{ width }}>
      <div className="right-tabs" role="tablist" aria-label="Right sidebar">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`right-tab${tab === t.id ? ' on' : ''}`}
            title={tabTitle(t, badges[t.id])}
            aria-label={tabName(t, badges[t.id])}
            onClick={() => showView(t.id)}
          >
            <t.icon size={14} />
            <span className="right-tab-label">{t.label}</span>
            <Badge b={badges[t.id]} />
          </button>
        ))}
        <button className="icon-btn right-close" title="Hide right sidebar" aria-label="Hide right sidebar" onClick={() => updateSettings({ rightPanelVisible: false })}>
          <PanelRightClose size={14} />
        </button>
      </div>
      <div className="right-body" role="tabpanel">
        {tab === 'overview' && <OverviewView />}
        {tab === 'agents' && <MissionsView />}
        {tab === 'skills' && <SkillsView />}
        {tab === 'context' && <ContextView />}
        {tab === 'workflows' && <WorkflowsView />}
      </div>
      <ResizeHandle side="right" />
    </aside>
  )
}
