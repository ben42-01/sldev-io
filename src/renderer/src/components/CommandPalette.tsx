import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyScore } from '../lib/commands'
import { closePicker, picker, type PickItem } from '../state/picker'
import { useStore } from '../state/store'

const MAX_SHOWN = 150

/** One picker for commands, quick open, branches…; contents come from showPicker(). */
export function CommandPalette(): React.JSX.Element | null {
  const open = useStore(picker, (p) => p.open)
  if (!open) return null
  return <Picker />
}

function Picker(): React.JSX.Element {
  const items = useStore(picker, (p) => p.items)
  const placeholder = useStore(picker, (p) => p.placeholder)
  const hint = useStore(picker, (p) => p.hint)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef(document.activeElement as HTMLElement | null)

  const results = useMemo(() => {
    if (!items) return []
    if (!query) return items.slice(0, MAX_SHOWN)
    const scored: Array<{ it: PickItem; s: number }> = []
    for (const it of items) {
      const s = fuzzyScore(query, `${it.category ?? ''} ${it.label} ${it.detail ?? ''}`)
      if (s >= 0) scored.push({ it, s: s + fuzzyScore(query, it.label) * 0.5 })
    }
    return scored.sort((a, b) => b.s - a.s).slice(0, MAX_SHOWN).map((r) => r.it)
  }, [items, query])

  useEffect(() => input.current?.focus(), [])
  useEffect(() => setIndex(0), [query, items])
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const close = (): void => {
    closePicker()
    requestAnimationFrame(() => restoreFocus.current?.focus())
  }
  const run = (fn: (() => void) | undefined): void => {
    if (!fn) return
    close()
    // let focus return before the action (it may focus a new terminal)
    requestAnimationFrame(() => requestAnimationFrame(fn))
  }

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          className="palette-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            const cur = results[index]
            if (e.key === 'Escape') close()
            else if (e.key === 'ArrowDown') setIndex((i) => Math.min(results.length - 1, i + 1))
            else if (e.key === 'ArrowUp') setIndex((i) => Math.max(0, i - 1))
            else if (e.key === 'Enter' && e.altKey) run(cur?.alt ?? cur?.run)
            else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(cur?.ctrl ?? cur?.run)
            else if (e.key === 'Enter') run(cur?.run)
            else return
            e.preventDefault()
          }}
        />
        <div className="palette-list" ref={list}>
          {results.map((c, i) => (
            <div key={c.id} className={`palette-item${i === index ? ' active' : ''}`} onMouseMove={() => setIndex(i)} onClick={() => run(c.run)}>
              {c.category && <span className="palette-cat">{c.category}:</span>}
              <span className="palette-title">{c.label}</span>
              {c.detail && <span className="palette-detail">{c.detail}</span>}
              {c.kbd && <kbd>{c.kbd}</kbd>}
            </div>
          ))}
          {items === null && <div className="palette-empty">Loading…</div>}
          {items !== null && !results.length && <div className="palette-empty">No matches</div>}
        </div>
        {hint && <div className="palette-hint">{hint}</div>}
      </div>
    </div>
  )
}
