import { useEffect, useState } from 'react'
import { DockviewDefaultTab, DockviewReact, type IDockviewPanelHeaderProps, type DockviewReadyEvent, type DockviewTheme, type IDockviewHeaderActionsProps, type SerializedDockview } from 'dockview-react'
import 'dockview/dist/styles/dockview.css'
import { Columns2, Maximize2, Minimize2, Plus, Rows2 } from 'lucide-react'
import { TerminalPanel } from './TerminalPanel'
import { DiffPanel } from './DiffPanel'
import { NotePanel } from './NotePanel'
import { MissionControlPanel } from './MissionControlPanel'
import { PreviewPanel } from './PreviewPanel'
import { SettingsPanel } from './SettingsPanel'
import { SetupPanel } from './SetupPanel'
import { PipelinePanel } from './PipelinePanel'
import { RecipesPanel } from './RecipesPanel'
import { DashboardPanel } from './DashboardPanel'
import { WhatsNewPanel } from './WhatsNewPanel'
import { AgentsPanel } from './AgentsPanel'
import { missions } from '../state/missions'
import { Welcome } from './Welcome'
import { applyTabLayout, onPanelRemoved, openTerminal, setDockApi } from './dockApi'
import { runs } from '../state/runs'
import { workspace } from '../state/workspace'
import { useStore } from '../state/store'
import { RunDot, StatusDot } from '../components/StatusDot'
import { missionSignal } from '@shared/status'
import { startupSetupCheck } from '../state/setup'
import { startupWhatsNew } from '../state/whatsNew'

const theme: DockviewTheme = { name: 'sldev', className: 'dockview-theme-sldev', colorScheme: 'dark', gap: 0 }
const components = { terminal: TerminalPanel, diff: DiffPanel, note: NotePanel, missions: MissionControlPanel, preview: PreviewPanel, settings: SettingsPanel, setup: SetupPanel, pipeline: PipelinePanel, recipes: RecipesPanel, dashboard: DashboardPanel, 'whats-new': WhatsNewPanel, agents: AgentsPanel }

/** Default tab plus a status dot for panels running a runtime, task or mission. */
function Tab(props: IDockviewPanelHeaderProps): React.JSX.Element {
  const run = useStore(runs, (s) => s.byPanel[props.api.id])
  const missionStatus = useStore(missions, (s) => {
    const id = Object.keys(s.panels).find((k) => s.panels[k] === props.api.id)
    return id ? s.list.find((m) => m.id === id)?.status : undefined
  })
  const [renaming, setRenaming] = useState(false)
  const rename = (name: string | null): void => {
    setRenaming(false)
    // empty or unchanged keeps the old name; a chosen name sticks (shells stop retitling the tab)
    if (name?.trim() && name.trim() !== props.api.title) {
      props.api.setTitle(name.trim())
      props.api.updateParameters({ customTitle: name.trim() })
    }
  }
  return (
    <div className="tab-wrap" onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
      {missionStatus ? <StatusDot signal={missionSignal(missionStatus)} /> : run && <RunDot run={run} />}
      {renaming ? (
        <input
          className="tab-rename"
          autoFocus
          defaultValue={props.api.title ?? ''}
          aria-label="Tab name"
          onFocus={(e) => e.currentTarget.select()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') rename(e.currentTarget.value)
            if (e.key === 'Escape') rename(null)
          }}
          onBlur={(e) => rename(e.currentTarget.value)}
        />
      ) : (
        <DockviewDefaultTab {...props} />
      )}
    </div>
  )
}

function GroupActions({ group, containerApi }: IDockviewHeaderActionsProps): React.JSX.Element {
  const [, rerender] = useState(0)
  useEffect(() => {
    const d = containerApi.onDidMaximizedGroupChange(() => rerender((n) => n + 1))
    const l = containerApi.onDidLayoutChange(() => rerender((n) => n + 1))
    return () => (d.dispose(), l.dispose())
  }, [containerApi])
  const max = group.api.isMaximized()
  return (
    <div className="group-actions">
      {(max || containerApi.groups.length > 1) && (
        <button
          className="icon-btn"
          title={max ? 'Restore the other splits' : 'Maximize this split (the others stay open behind it)'}
          aria-label={max ? 'Restore the other splits' : 'Maximize this split'}
          onClick={() => (max ? group.api.exitMaximized() : group.api.maximize())}
        >
          {max ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      )}
      <button className="icon-btn" title="New terminal in this group" aria-label="New terminal in this group" onClick={() => openTerminal({ referenceGroup: group.id })}>
        <Plus size={14} />
      </button>
      <button className="icon-btn" title="Split right" aria-label="Split right" onClick={() => openTerminal({ referenceGroup: group.id, direction: 'right' })}>
        <Columns2 size={14} />
      </button>
      <button className="icon-btn" title="Split down" aria-label="Split down" onClick={() => openTerminal({ referenceGroup: group.id, direction: 'below' })}>
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
  // saved layouts carry each group's header position; the setting wins
  applyTabLayout()
  api.onDidAddGroup(() => applyTabLayout())
  let tabLayout = workspace.get().tabLayout
  workspace.subscribe(() => {
    if (workspace.get().tabLayout === tabLayout) return
    tabLayout = workspace.get().tabLayout
    applyTabLayout()
  })

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
