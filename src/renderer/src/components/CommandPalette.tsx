import { useEffect, useMemo, useRef, useState } from 'react'
import { dynamicCommands, fuzzyScore, shortcutLabel, staticCommands, type Command } from '../lib/commands'
import { workspace } from '../state/workspace'
import { useStore } from '../state/store'

export function CommandPalette({ home }: { home: string }): React.JSX.Element | null {
  const open = useStore(workspace, (w) => w.paletteOpen)
  if (!open) return null
  return <Palette home={home} />
}

function Palette({ home }: { home: string }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef(document.activeElement as HTMLElement | null)

  const commands = useMemo(() => [...staticCommands().filter((c) => c.id !== 'palette.show'), ...dynamicCommands(home)], [home])
  const results = useMemo(() => {
    if (!query) return commands
    return commands
      .map((c) => ({ c, s: fuzzyScore(query, `${c.category ?? ''} ${c.title}`) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c)
  }, [commands, query])

  useEffect(() => input.current?.focus(), [])
  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const close = (refocus = true): void => {
    workspace.set({ paletteOpen: false })
    if (refocus) requestAnimationFrame(() => restoreFocus.current?.focus())
  }
  const run = (c: Command | undefined): void => {
    if (!c) return
    close(true)
    // let the palette unmount and focus return before the command acts (it may focus a new terminal)
    requestAnimationFrame(() => requestAnimationFrame(c.run))
  }

  return (
    <div className="palette-backdrop" onMouseDown={() => close()}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          className="palette-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            else if (e.key === 'ArrowDown') setIndex((i) => Math.min(results.length - 1, i + 1))
            else if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1))
            else if (e.key === 'Enter') run(results[index])
            else return
            e.preventDefault()
          }}
        />
        <div className="palette-list" ref={list}>
          {results.map((c, i) => (
            <div key={c.id} className={`palette-item${i === index ? ' active' : ''}`} onMouseMove={() => setIndex(i)} onClick={() => run(c)}>
              {c.category && <span className="palette-cat">{c.category}:</span>}
              <span className="palette-title">{c.title}</span>
              {shortcutLabel(c) && <kbd>{shortcutLabel(c)}</kbd>}
            </div>
          ))}
          {!results.length && <div className="palette-empty">No matching commands</div>}
        </div>
      </div>
    </div>
  )
}
