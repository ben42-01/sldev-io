import { Check } from 'lucide-react'
import { createStore, useStore } from '../state/store'

/** A short confirmation at the bottom of the window ("Copied…"), gone after a few seconds. Not for errors that need an answer. */
const toasts = createStore<{ now: { text: string; id: number } | null }>({ now: null })
let timer: ReturnType<typeof setTimeout> | undefined

export function toast(text: string): void {
  clearTimeout(timer)
  toasts.set({ now: { text, id: Date.now() } })
  timer = setTimeout(() => toasts.set({ now: null }), 3200)
}

export function ToastHost(): React.JSX.Element | null {
  const t = useStore(toasts, (s) => s.now)
  if (!t) return null
  return (
    <div className="toast" role="status" aria-live="polite" key={t.id}>
      <Check size={13} /> {t.text}
    </div>
  )
}
