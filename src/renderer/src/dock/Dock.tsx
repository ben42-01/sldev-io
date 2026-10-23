import { DockviewDefaultTab, DockviewReact, type IDockviewPanelHeaderProps, type DockviewReadyEvent, type DockviewTheme, type IDockviewHeaderActionsProps, type SerializedDockview } from 'dockview-react'
import 'dockview/dist/styles/dockview.css'
import { Columns2, Plus, Rows2 } from 'lucide-react'
import { TerminalPanel } from './TerminalPanel'
import { Welcome } from './Welcome'
import { onPanelRemoved, openTerminal, setDockApi } from './dockApi'
import { runs } from '../state/runs'
import { useStore } from '../state/store'
import { StatusDot } from '../components/StatusDot'

const theme: DockviewTheme = { name: 'sldev', className: 'dockview-theme-sldev', colorScheme: 'dark', gap: 0 }
const components = { terminal: TerminalPanel }

/** Default tab plus a status dot for panels running a runtime or task. */
function Tab(props: IDockviewPanelHeaderProps): React.JSX.Element {
  const run = useStore(runs, (s) => s.byPanel[props.api.id])
  return (
    <div className="tab-wrap">
      {run && <StatusDot run={run} />}
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
