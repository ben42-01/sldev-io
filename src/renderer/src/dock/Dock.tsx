import { DockviewDefaultTab, DockviewReact, type IDockviewPanelHeaderProps, type DockviewReadyEvent, type DockviewTheme, type IDockviewHeaderActionsProps, type SerializedDockview } from 'dockview-react'
import 'dockview/dist/styles/dockview.css'
import { Columns2, Plus, Rows2 } from 'lucide-react'
import { TerminalPanel } from './TerminalPanel'
import { DiffPanel } from './DiffPanel'
import { NotePanel } from './NotePanel'
import { MissionBoardPanel } from './MissionBoardPanel'
import { PreviewPanel } from './PreviewPanel'
import { SettingsPanel } from './SettingsPanel'
import { SetupPanel } from './SetupPanel'
import { PipelinePanel } from './PipelinePanel'
import { DashboardPanel } from './DashboardPanel'
import { WhatsNewPanel } from './WhatsNewPanel'
import { missions } from '../state/missions'
import { Welcome } from './Welcome'
import { onPanelRemoved, openTerminal, setDockApi } from './dockApi'
import { runs } from '../state/runs'
import { useStore } from '../state/store'
import { StatusDot } from '../components/StatusDot'
import { startupSetupCheck } from '../state/setup'
import { startupWhatsNew } from '../state/whatsNew'

const theme: DockviewTheme = { name: 'sldev', className: 'dockview-theme-sldev', colorScheme: 'dark', gap: 0 }
const components = { terminal: TerminalPanel, diff: DiffPanel, note: NotePanel, missions: MissionBoardPanel, preview: PreviewPanel, settings: SettingsPanel, setup: SetupPanel, pipeline: PipelinePanel, dashboard: DashboardPanel, 'whats-new': WhatsNewPanel }

/** Default tab plus a status dot for panels running a runtime, task or mission. */
function Tab(props: IDockviewPanelHeaderProps): React.JSX.Element {
  const run = useStore(runs, (s) => s.byPanel[props.api.id])
  const missionStatus = useStore(missions, (s) => {
    const id = Object.keys(s.panels).find((k) => s.panels[k] === props.api.id)
    return id ? s.list.find((m) => m.id === id)?.status : undefined
  })
  return (
    <div className="tab-wrap">
      {missionStatus ? <span className={`mission-dot ${missionStatus}`} title={missionStatus} /> : run && <StatusDot run={run} />}
      <DockviewDefaultTab {...props} />
    </div>
  )
}

function GroupActions({ group }: IDockviewHeaderActionsProps): React.JSX.Element {
  return (
    <div className="group-actions">
      <button className="icon-btn" title="New terminal in this group" onClick={() => openTerminal({ referenceGroup: group.id })}>
        <Plus size={14} />
      </button>
      <button className="icon-btn" title="Split right" onClick={() => openTerminal({ referenceGroup: group.id, direction: 'right' })}>
        <Columns2 size={14} />
      </button>
      <button className="icon-btn" title="Split down" onClick={() => openTerminal({ referenceGroup: group.id, direction: 'below' })}>
        <Rows2 size={14} />
      </button>
    </div>
  )
}

async function onReady(e: DockviewReadyEvent): Promise<void> {
  const api = e.api
  setDockApi(api)
  api.onDidRemovePanel((p) => onPanelRemoved(p.id))

  // Restore the previous layout; terminals come back as fresh shells in the same directories.
  const saved = (await window.api.layout.load()) as SerializedDockview | null
  if (saved) {
    try {
      api.fromJSON(saved)
    } catch {
      api.clear()
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  api.onDidLayoutChange(() => {
    clearTimeout(timer)
    timer = setTimeout(() => void window.api.layout.save(api.toJSON()), 500)
  })
  // before the setup check, which marks setupSeen on a first launch
  void startupWhatsNew().then(startupSetupCheck)
}

export function Dock(): React.JSX.Element {
  return (
    <DockviewReact
      className="dock"
      theme={theme}
      components={components}
      defaultRenderer="always"
      watermarkComponent={Welcome}
      defaultTabComponent={Tab}
      rightHeaderActionsComponent={GroupActions}
      onReady={(e) => void onReady(e)}
    />
  )
}
