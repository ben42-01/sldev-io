import { Check, ChevronDown, FolderOpen, FolderPlus, Satellite, Search } from 'lucide-react'
import { projectMenu, workLabel } from '@shared/projects'
import { pickRootFolder, setRootFolder, updateSettings, workspace } from '../state/workspace'
import { showAbout, showCommandPalette } from '../lib/commands'
import { useStore } from '../state/store'
import { basename } from '../lib/paths'
import { updates } from '../state/updates'
import { openMissionControl } from '../dock/MissionControlPanel'
import { Logo } from './Logo'
import { openNewProject } from './NewProjectDialog'
import { showContextMenu, type MenuItem } from './ContextMenu'
import { useProjectWork, WorkDot } from './ProjectWork'

const isMac = window.api.platform === 'darwin'

export function TitleBar(): React.JSX.Element {
  const root = useStore(workspace, (w) => w.rootFolder)
  const recent = useStore(workspace, (w) => w.recentFolders)
  const version = useStore(updates, (u) => u.info?.version)
  const work = useProjectWork()
  // work waiting in a project that isn't open: the menu button says so, so it isn't missed
  const elsewhere = [...work.values()].filter((w) => w.root !== root)
  const othersNeed = elsewhere.reduce((n, w) => n + w.needs, 0)

  const openMenu = (e: React.MouseEvent<HTMLButtonElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    const items: MenuItem[] = [
      { type: 'header', label: 'Projects' },
      ...projectMenu(root, work, recent).map(
        (p): MenuItem => ({
          label: basename(p),
          icon: p === root ? <Check size={13} /> : <WorkDot work={work.get(p)} />,
          shortcut: workLabel(work.get(p)),
          run: () => p !== root && setRootFolder(p)
        })
      ),
      { type: 'separator' },
      { label: 'New project…', icon: <FolderPlus size={13} />, run: openNewProject },
      { label: 'Open folder…', icon: <FolderOpen size={13} />, shortcut: isMac ? '⌘O' : 'Ctrl+Shift+O', run: () => void pickRootFolder() },
      {
        label: 'Missions in all projects',
        icon: <Satellite size={13} />,
        run: () => {
          updateSettings({ missionScope: 'all' })
          openMissionControl('missions')
        }
      }
    ]
    showContextMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault: () => undefined }, items)
  }

  return (
    <div className={`titlebar${isMac ? ' mac' : ''}`}>
      <div className="titlebar-brand">
        <Logo size={16} />
        sldev-io
        {version && (
          <button className="titlebar-version" title="About sldev-io" onClick={showAbout}>
            v{version}
          </button>
        )}
      </div>
      <div className="titlebar-center">
        <div className="titlebar-project-slot">
          <button
            className="titlebar-project"
            title={`${root ?? 'No folder open'}\nSwitch project`}
            aria-label="Switch project"
            aria-haspopup="menu"
            onClick={openMenu}
          >
            <WorkDot work={root ? work.get(root) : undefined} />
            <span>{root ? basename(root) : 'Open a project'}</span>
            {othersNeed > 0 && <span className="titlebar-elsewhere" title={`${othersNeed} in other projects need${othersNeed === 1 ? 's' : ''} you`}>+{othersNeed}</span>}
            <ChevronDown size={12} />
          </button>
        </div>
        <button className="titlebar-search" onClick={showCommandPalette}>
          <Search size={13} />
          <span>Search commands</span>
          <kbd>{isMac ? '⌘⇧P' : 'Ctrl+Shift+P'}</kbd>
        </button>
      </div>
      <div className="titlebar-spacer" />
    </div>
  )
}
