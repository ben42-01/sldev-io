import { useEffect, useState } from 'react'
import { ActivityBar } from './components/ActivityBar'
import { CommandPalette } from './components/CommandPalette'
import { ContextMenuHost } from './components/ContextMenu'
import { PromptHost } from './components/PromptHost'
import { ConfirmHost } from './components/Modal'
import { ToastHost } from './components/Toast'
import { RecapHost } from './components/RecapDialog'
import { MissionDetailsHost } from './components/MissionDetails'
import { NewMissionHost } from './components/MissionsView'
import { NewRunHost } from './components/FactoryView'
import { ImportRecipeHost } from './dock/RecipesPanel'
import './lib/actions'
import { Sidebar } from './components/Sidebar'
import { RightPanel } from './components/RightPanel'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { Dock } from './dock/Dock'
import { matchShortcut, staticCommands } from './lib/commands'
import { initWorkspace, workspace } from './state/workspace'
import { refreshInstalledAgents } from './state/agents'
import { useStore } from './state/store'
import { reviewFocus } from './state/focus'
import { beta, initBeta } from './state/beta'
import { initUpdates } from './state/updates'
import { initBadge } from './state/badge'
import { BetaBanner, BetaEnded } from './components/BetaGate'

export function App(): React.JSX.Element {
  const ready = useStore(workspace, (w) => w.ready)
  const betaChecked = useStore(beta, (b) => b.status !== null)
  const locked = useStore(beta, (b) => b.locked)
  const [home, setHome] = useState('')

  useEffect(() => {
    // the beta check decides whether the workspace (and its terminals) start at all
    void initBeta().then(() => {
      // agents start under whichever name their CLI is installed as, so look before anything runs
      if (!beta.get().locked) void initWorkspace().then(refreshInstalledAgents)
    })
    void initUpdates()
    initBadge()
    void window.api.fs.home().then(setHome)
  }, [])

  // unlocked from the ended screen ("Check again" after the beta was extended)
  useEffect(() => {
    if (betaChecked && !locked && !workspace.get().ready) void initWorkspace()
  }, [betaChecked, locked])

  // App shortcuts are matched in the capture phase so they win over a focused terminal.
  useEffect(() => {
    const commands = staticCommands()
    const onKey = (e: KeyboardEvent): void => {
      // typing in a dialog or a form field isn't a shortcut (the terminal's hidden textarea still is)
      const t = e.target instanceof HTMLElement ? e.target : null
      if (t?.closest('dialog[open]') || (t?.closest('form') && t.matches('input, textarea, select'))) return
      const c = matchShortcut(e, commands)
      if (!c) return
      e.preventDefault()
      e.stopPropagation()
      c.run()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const focused = useStore(reviewFocus, (f) => !!f.panel)
  if (locked) return <BetaEnded />
  if (!ready) return <div className="app loading" />
  return (
    <div className={`app${focused ? ' focus-review' : ''}`}>
      <TitleBar />
      <BetaBanner />
      <div className="main">
        <ActivityBar />
        <Sidebar home={home} />
        <div className="dock-area">
          <Dock />
        </div>
        <RightPanel />
      </div>
      <StatusBar home={home} />
      <CommandPalette />
      <ContextMenuHost />
      <PromptHost />
      <MissionDetailsHost />
      <NewMissionHost />
      <NewRunHost />
      <ImportRecipeHost />
      <ConfirmHost />
      <ToastHost />
      <RecapHost />
    </div>
  )
}
