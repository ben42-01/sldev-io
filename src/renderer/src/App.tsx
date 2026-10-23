import { useEffect, useState } from 'react'
import { ActivityBar } from './components/ActivityBar'
import { CommandPalette } from './components/CommandPalette'
import { ContextMenuHost } from './components/ContextMenu'
import { PromptHost } from './components/PromptHost'
import './lib/actions'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { Dock } from './dock/Dock'
import { matchShortcut, staticCommands } from './lib/commands'
import { initWorkspace, workspace } from './state/workspace'
import { useStore } from './state/store'

export function App(): React.JSX.Element {
  const ready = useStore(workspace, (w) => w.ready)
  const [home, setHome] = useState('')

  useEffect(() => {
    void initWorkspace()
    void window.api.fs.home().then(setHome)
  }, [])

  // App shortcuts are matched in the capture phase so they win over a focused terminal.
  useEffect(() => {
    const commands = staticCommands()
    const onKey = (e: KeyboardEvent): void => {
      const c = matchShortcut(e, commands)
      if (!c) return
      e.preventDefault()
      e.stopPropagation()
      c.run()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  if (!ready) return <div className="app loading" />
  return (
    <div className="app">
      <TitleBar />
      <div className="main">
        <ActivityBar />
        <Sidebar home={home} />
        <div className="dock-area">
          <Dock />
        </div>
      </div>
      <StatusBar home={home} />
      <CommandPalette />
      <ContextMenuHost />
      <PromptHost />
    </div>
  )
}
