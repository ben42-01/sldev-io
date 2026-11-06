import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { fuzzyMatches, fuzzyScore, pushRecent, withRecentFirst } from '../lib/fuzzy'
import { closePicker, picker, type PickItem } from '../state/picker'
import { useStore } from '../state/store'

const MAX_SHOWN = 150

// what was picked recently, per picker (its placeholder names it); a convenience, so storage may fail quietly
const recentKey = (placeholder: string): string => `sldev.picker.recent:${placeholder}`
function readRecent(placeholder: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(recentKey(placeholder)) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}
function rememberPick(placeholder: string, id: string): void {
  try {
    localStorage.setItem(recentKey(placeholder), JSON.stringify(pushRecent(readRecent(placeholder), id)))
  } catch {
    // private mode or full storage: recents just don't stick
  }
}

/** The label with the characters the query matched in bold. */
function Highlight({ text, query }: { text: string; query: string }): React.JSX.Element {
  const hits = query ? fuzzyMatches(query, text) : null
  if (!hits?.length) return <>{text}</>
  const set = new Set(hits)
  const parts: React.ReactNode[] = []
  let run = ''
  let on = false
  const flush = (): void => {
    if (run) parts.push(on ? <mark key={parts.length}>{run}</mark> : run)
    run = ''
  }
  for (let i = 0; i < text.length; i++) {
    if (set.has(i) !== on) {
      flush()
      on = !on
    }
    run += text[i]
  }
  flush()
  return <>{parts}</>
}

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
  const [recent] = useState(() => readRecent(placeholder))
  const recentSet = useMemo(() => new Set(recent), [recent])

  const results = useMemo(() => {
    if (!items) return []
    if (!query) return withRecentFirst(items, recent).slice(0, MAX_SHOWN)
    const scored: Array<{ it: PickItem; s: number }> = []
    for (const it of items) {
      const s = fuzzyScore(query, `${it.category ?? ''} ${it.label} ${it.detail ?? ''}`)
      if (s >= 0) scored.push({ it, s: s + fuzzyScore(query, it.label) * 0.5 })
    }
    return scored.sort((a, b) => b.s - a.s).slice(0, MAX_SHOWN).map((r) => r.it)
  }, [items, query, recent])

  useEffect(() => input.current?.focus(), [])
  useEffect(() => setIndex(0), [query, items])
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const close = (): void => {
    closePicker()
    requestAnimationFrame(() => restoreFocus.current?.focus())
  }
  const run = (fn: (() => void) | undefined, id?: string): void => {
    if (!fn) return
    if (id) rememberPick(placeholder, id)
    close()
    // let focus return before the action (it may focus a new terminal)
    requestAnimationFrame(() => requestAnimationFrame(fn))
  }

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div className="palette brand-frame" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-search">
          <Search size={15} aria-hidden />
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
              else if (e.key === 'Enter' && e.altKey) run(cur?.alt ?? cur?.run, cur?.id)
              else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run(cur?.ctrl ?? cur?.run, cur?.id)
              else if (e.key === 'Enter') run(cur?.run, cur?.id)
              else return
              e.preventDefault()
            }}
          />
        </div>
        <div className="palette-list" ref={list}>
          {results.map((c, i) => (
            <div key={c.id} className={`palette-item${i === index ? ' active' : ''}`} onMouseMove={() => setIndex(i)} onClick={() => run(c.run, c.id)}>
              {c.category && <span className="palette-cat">{c.category}</span>}
              <span className="palette-title"><Highlight text={c.label} query={query} /></span>
              {!query && recentSet.has(c.id) && <span className="palette-recent">recent</span>}
              {c.detail && <span className="palette-detail">{c.detail}</span>}
              {c.kbd && <kbd>{c.kbd}</kbd>}
            </div>
          ))}
          {items === null && <div className="palette-empty">Loading…</div>}
          {items !== null && !results.length && <div className="palette-empty">No matches</div>}
        </div>
        <div className="palette-hint">
          <span className="palette-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>Enter</kbd> run <kbd>Esc</kbd> close</span>
          {hint && <span className="palette-hint-text">{hint}</span>}
        </div>
      </div>
    </div>
  )
}
