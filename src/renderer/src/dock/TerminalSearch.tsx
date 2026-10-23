import { useEffect, useRef, useState } from 'react'
import type { DockviewPanelApi } from 'dockview-react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { clearSearch, findInTerminal, focusTerminal } from '../lib/terminals'

/** Find bar, opened by the app-level "find" shortcut via a DOM event targeted at the active panel. */
export function TerminalSearch({ id, panelApi }: { id: string; panelApi: DockviewPanelApi }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onFind = (e: Event): void => {
      if ((e as CustomEvent<string>).detail !== id) return
      setOpen(true)
      requestAnimationFrame(() => input.current?.select())
    }
    window.addEventListener('sldev:find', onFind)
    return () => window.removeEventListener('sldev:find', onFind)
  }, [id])

  if (!open) return null
  const close = (): void => {
    setOpen(false)
    clearSearch(id)
    focusTerminal(id)
  }
  return (
    <div className="terminal-search" onMouseDown={() => panelApi.setActive()}>
      <input
        ref={input}
        value={query}
        placeholder="Find"
        onChange={(e) => {
          setQuery(e.target.value)
          findInTerminal(id, e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter') findInTerminal(id, query, e.shiftKey)
        }}
      />
      <button className="icon-btn" title="Previous (Shift+Enter)" onClick={() => findInTerminal(id, query, true)}>
        <ChevronUp size={14} />
      </button>
      <button className="icon-btn" title="Next (Enter)" onClick={() => findInTerminal(id, query)}>
        <ChevronDown size={14} />
      </button>
      <button className="icon-btn" title="Close (Esc)" onClick={close}>
        <X size={14} />
      </button>
    </div>
  )
}
