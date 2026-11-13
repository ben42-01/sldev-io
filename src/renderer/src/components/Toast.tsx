import { Check, CircleAlert } from 'lucide-react'
import { createStore, useStore } from '../state/store'

/**
 * A short message at the bottom of the window ("Copied…"), gone after a few seconds. Not for errors that need an
 * answer; an 'error' toast only reports that something failed, and the full message stays where it happened.
 */
const toasts = createStore<{ now: { text: string; id: number; tone: 'ok' | 'error' } | null }>({ now: null })
let timer: ReturnType<typeof setTimeout> | undefined

export function toast(text: string, ms = 3200, tone: 'ok' | 'error' = 'ok'): void {
  clearTimeout(timer)
  toasts.set({ now: { text, id: Date.now(), tone } })
  timer = setTimeout(() => toasts.set({ now: null }), ms)
}

export function ToastHost(): React.JSX.Element | null {
  const t = useStore(toasts, (s) => s.now)
  if (!t) return null
  return (
    <div className={`toast${t.tone === 'error' ? ' tone-error' : ''}`} role={t.tone === 'error' ? 'alert' : 'status'} aria-live="polite" key={t.id}>
      {t.tone === 'error' ? <CircleAlert size={13} /> : <Check size={13} />} {t.text}
    </div>
  )
}
