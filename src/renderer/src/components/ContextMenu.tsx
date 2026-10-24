import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createStore, useStore } from '../state/store'

export type MenuItem =
  | { type?: 'item'; label: string; shortcut?: string; icon?: React.ReactNode; disabled?: boolean; run: () => void }
  | { type: 'separator' }
  | { type: 'header'; label: string }

const menu = createStore<{ x: number; y: number; items: MenuItem[] | null }>({ x: 0, y: 0, items: null })

export function showContextMenu(e: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[]): void {
  e.preventDefault()
  menu.set({ x: e.clientX, y: e.clientY, items })
}

const close = (): void => menu.set({ items: null })

export function ContextMenuHost(): React.JSX.Element | null {
  const items = useStore(menu, (m) => m.items)
  const x = useStore(menu, (m) => m.x)
  const y = useStore(menu, (m) => m.y)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // keep the menu inside the window
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: Math.min(x, window.innerWidth - r.width - 4), y: Math.min(y, window.innerHeight - r.height - 4) })
  }, [items, x, y])

  useEffect(() => {
    if (!items) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [items])

  if (!items) return null
  return (
    <div className="ctx-backdrop" onMouseDown={close} onContextMenu={(e) => (e.preventDefault(), close())}>
      <div ref={ref} className="ctx-menu brand-frame" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
        {items.map((it, i) =>
          it.type === 'separator' ? (
            <div key={i} className="ctx-sep" />
          ) : it.type === 'header' ? (
            <div key={i} className="ctx-header">{it.label}</div>
          ) : (
            <button
              key={i}
              className="ctx-item"
              disabled={it.disabled}
              onClick={() => {
                close()
                it.run()
              }}
            >
              <span className="ctx-icon">{it.icon}</span>
              <span className="ctx-label">{it.label}</span>
              {it.shortcut && <span className="ctx-shortcut">{it.shortcut}</span>}
            </button>
          )
        )}
      </div>
    </div>
  )
}
