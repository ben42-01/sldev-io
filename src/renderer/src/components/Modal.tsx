import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { createStore, useStore } from '../state/store'

export interface ModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  /** right-aligned buttons; Cancel (ghost) → secondary → primary */
  footer?: ReactNode
  /** left side of the footer: context such as where secrets are kept */
  footerNote?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** while true, Esc, the backdrop and ✕ don't close it (a request is in flight) */
  busy?: boolean
  /** the field to focus on open; default: the first input, textarea or select */
  initialFocus?: RefObject<HTMLElement | null>
  /** submitting runs this (Enter in a field); the footer's primary button should be type="submit" */
  onSubmit?: () => void
  tone?: 'danger'
}

/**
 * The one modal: a native <dialog> (focus trap and Esc for free) portalled to <body>. The body
 * scrolls on its own so the header and footer stay visible. The backdrop closes it on mouse-down,
 * so dragging a text selection out of the panel doesn't.
 */
export function Modal({ title, onClose, children, footer, footerNote, size = 'md', busy = false, initialFocus, onSubmit, tone }: ModalProps): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    const d = ref.current!
    if (!d.open) d.showModal()
    const target =
      initialFocus?.current ??
      d.querySelector<HTMLElement>('.modal-body :is(input:not([type=checkbox]), textarea, select)') ??
      d.querySelector<HTMLElement>('[data-autofocus]:not(:disabled)') ??
      d.querySelector<HTMLElement>('.modal-footer .btn:not(:disabled)')
    target?.focus()
    return () => d.close()
  }, [])

  const close = (): void => {
    if (!busyRef.current) onClose()
  }

  return createPortal(
    <dialog
      ref={ref}
      className="modal-dialog"
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <form
        className={`modal-panel aurora ${size}${tone ? ` ${tone}` : ''}`}
        onSubmit={(e) => {
          e.preventDefault()
          if (!busyRef.current) onSubmit?.()
        }}
      >
        <header className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" title="Close (Esc)" disabled={busy} onClick={close}>
            <X size={14} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {(footer || footerNote) && (
          <footer className="modal-footer">
            {footerNote && <div className="modal-footer-note">{footerNote}</div>}
            {footer}
          </footer>
        )}
      </form>
    </dialog>,
    document.body
  )
}

// ── confirmations ────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string
  /** what happens, in a sentence */
  message?: ReactNode
  /** "Removed:" / "Kept:" lines, so the consequence is spelled out */
  removes?: ReactNode[]
  keeps?: ReactNode[]
  /** things that must be resolved first; the confirm button stays disabled while any are listed */
  blockers?: ReactNode[]
  /** opt-in extra steps, e.g. also delete the branch; `required` ones must be ticked to confirm */
  checks?: { id: string; label: ReactNode; required?: boolean; initial?: boolean }[]
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
}

interface Pending extends ConfirmOptions {
  id: number
  resolve: (r: Record<string, boolean> | null) => void
}

const confirms = createStore<{ queue: Pending[] }>({ queue: [] })
let nextId = 0

/**
 * Ask before a destructive step, in the app (never window.confirm). Resolves to the ticked checks
 * when confirmed, or null when cancelled.
 */
export function confirmAction(o: ConfirmOptions): Promise<Record<string, boolean> | null> {
  return new Promise((resolve) => confirms.set((s) => ({ queue: [...s.queue, { ...o, id: ++nextId, resolve }] })))
}

/** A message with one OK button, for errors that used to be window.alert. */
export function showNotice(title: string, message: ReactNode): Promise<unknown> {
  return confirmAction({ title, message, confirmLabel: 'OK', cancelLabel: '' })
}

export function ConfirmHost(): React.JSX.Element | null {
  const c = useStore(confirms, (s) => s.queue[0])
  if (!c) return null
  return <ConfirmDialog key={c.id} c={c} />
}

function ConfirmDialog({ c }: { c: Pending }): React.JSX.Element {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => Object.fromEntries((c.checks ?? []).map((x) => [x.id, !!x.initial])))
  const done = (r: Record<string, boolean> | null): void => {
    confirms.set((s) => ({ queue: s.queue.slice(1) }))
    c.resolve(r)
  }
  const blocked = (c.blockers?.length ?? 0) > 0 || (c.checks ?? []).some((x) => x.required && !checked[x.id])
  return (
    <Modal
      title={c.title}
      size="sm"
      tone={c.danger ? 'danger' : undefined}
      onClose={() => done(null)}
      onSubmit={() => !blocked && done(checked)}
      footer={
        <>
          {c.cancelLabel !== '' && (
            <button type="button" className="btn ghost" onClick={() => done(null)}>
              {c.cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button type="submit" className={`btn ${c.danger ? 'danger-solid' : 'primary'}`} disabled={blocked} data-autofocus>
            {c.confirmLabel}
          </button>
        </>
      }
    >
      {c.message && <div className="confirm-message">{c.message}</div>}
      {!!c.removes?.length && (
        <div className="confirm-list">
          <span className="label">Removed</span>
          <ul>{c.removes.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {!!c.keeps?.length && (
        <div className="confirm-list">
          <span className="label">Kept</span>
          <ul>{c.keeps.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {!!c.blockers?.length && (
        <div className="banner tone-error" role="alert">
          <ul>{c.blockers.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {c.checks?.map((x) => (
        <label key={x.id} className="check">
          <input type="checkbox" checked={!!checked[x.id]} onChange={(e) => setChecked((v) => ({ ...v, [x.id]: e.target.checked }))} />
          <span>{x.label}</span>
        </label>
      ))}
    </Modal>
  )
}
