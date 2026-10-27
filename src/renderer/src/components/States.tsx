import type { ReactNode } from 'react'
import { LoaderCircle, RotateCw } from 'lucide-react'

/**
 * Honest states for every async region (UI guide §5.10–5.12): what's empty and why, what is
 * loading, and errors with a way out. Never a bare spinner or a silent blank.
 */

export function Empty({ icon, title, hint, action, big = false }: { icon?: ReactNode; title: string; hint?: ReactNode; action?: ReactNode; big?: boolean }): React.JSX.Element {
  return (
    <div className={`empty${big ? ' big' : ''}`}>
      {icon && <div className="empty-icon">{icon}</div>}
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action}
    </div>
  )
}

export function Loading({ what }: { what: string }): React.JSX.Element {
  return (
    <div className="loading-row" role="status">
      <LoaderCircle size={13} className="spin" /> {what}
    </div>
  )
}

export function ErrorBanner({ children, onRetry, retryLabel = 'Retry' }: { children: ReactNode; onRetry?: () => void; retryLabel?: string }): React.JSX.Element {
  return (
    <div className="banner tone-error error-banner" role="alert">
      <div className="error-banner-text">{children}</div>
      {onRetry && (
        <button type="button" className="btn sm" onClick={onRetry}>
          <RotateCw size={12} /> {retryLabel}
        </button>
      )}
    </div>
  )
}
