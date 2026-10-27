import { processSignal, type Signal } from '@shared/status'
import type { Run } from '../state/runs'

/** A dot in the signal's tone; a live one gets a ping halo behind it (never a blink). */
export function StatusDot({ signal, small = false, title }: { signal: Signal; small?: boolean; title?: string }): React.JSX.Element {
  return <span className={`sdot tone-${signal.tone}${small ? ' small' : ''}${signal.pulse ? ' pulse' : ''}`} title={title ?? signal.label} role="img" aria-label={signal.label} />
}

/** Dot + label in a tinted pill; one class for every tone (it uses currentColor). */
export function StatusPill({ signal, label }: { signal: Signal; label?: string }): React.JSX.Element {
  return (
    <span className={`spill tone-${signal.tone}`}>
      <StatusDot signal={signal} small title="" />
      {label ?? signal.label}
    </span>
  )
}

/** The process state of a runtime or task terminal. */
export function RunDot({ run }: { run: Run | undefined }): React.JSX.Element {
  return <StatusDot signal={processSignal(run?.status, run?.exitCode)} />
}
