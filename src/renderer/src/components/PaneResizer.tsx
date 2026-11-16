import { useRef } from 'react'
import { updateSettings, workspace } from '../state/workspace'

export const REVIEW_LIST = { min: 180, max: 560, initial: 260 }
/** the ship bar's workflow runs list; dragged below `min`, it closes */
export const SHIP_RUNS = { min: 56, max: 520, initial: 150 }

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** The Review tab's list width (walkthrough parts or changed files), within its limits. */
export const reviewListWidth = (w: number | undefined): number => clamp(w ?? REVIEW_LIST.initial, REVIEW_LIST.min, REVIEW_LIST.max)
export const shipRunsHeight = (h: number | undefined): number => clamp(h ?? SHIP_RUNS.initial, SHIP_RUNS.min, SHIP_RUNS.max)

interface DividerProps {
  /** 'x': a vertical line dragged left/right; 'y': a horizontal line dragged up/down */
  axis: 'x' | 'y'
  label: string
  title: string
  /** the size when the drag starts */
  start: () => number
  /** the dragged size, unclamped; `done` once the drag (or a key press) ends */
  onSize: (size: number, done: boolean) => void
  onReset: () => void
  className?: string
}

/**
 * A divider to drag: pointer drag, double-click to reset, arrow keys when focused. Like the sidebars' handle,
 * any way a drag ends (pointerup, cancel, lost capture, window blur) clears the body's resize cursor.
 */
export function Divider({ axis, label, title, start, onSize, onReset, className = '' }: DividerProps): React.JSX.Element {
  const pos = (e: { clientX: number; clientY: number }): number => (axis === 'x' ? e.clientX : e.clientY)
  /** a double-click resets only when neither click was a drag: two quick drags aren't a double-click */
  const dragged = useRef(false)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const from = pos(e)
    if (e.detail <= 1) dragged.current = false
    const size = start()
    let last = size
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const cls = axis === 'x' ? 'resizing' : 'resizing-y'
    document.body.classList.add(cls)
    const move = (ev: PointerEvent): void => {
      last = size + pos(ev) - from
      if (Math.abs(pos(ev) - from) > 3) dragged.current = true
      onSize(last, false)
    }
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('lostpointercapture', up)
      window.removeEventListener('blur', up)
      if (!document.body.classList.contains(cls)) return
      document.body.classList.remove(cls)
      onSize(last, true)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('lostpointercapture', up)
    window.addEventListener('blur', up)
  }
  const onKey = (e: React.KeyboardEvent): void => {
    const step = (e.shiftKey ? 60 : 20) * (e.key === (axis === 'x' ? 'ArrowLeft' : 'ArrowUp') ? -1 : e.key === (axis === 'x' ? 'ArrowRight' : 'ArrowDown') ? 1 : 0)
    if (!step) return
    e.preventDefault()
    e.stopPropagation()
    onSize(start() + step, true)
  }
  return (
    <div
      className={`pane-resizer ${axis === 'x' ? 'x' : 'y'} ${className}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={title}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => !dragged.current && onReset()}
      onKeyDown={onKey}
    />
  )
}

/** The divider on the right edge of the Review tab's list; the width is shared by both views and every review tab. */
export function ReviewListResizer(): React.JSX.Element {
  const set = (w: number, save: boolean): void => {
    const v = reviewListWidth(w)
    if (save) updateSettings({ reviewListWidth: v })
    else workspace.set({ reviewListWidth: v })
  }
  return (
    <Divider
      axis="x"
      label="Resize the list"
      title="Drag to resize · double-click to reset"
      start={() => reviewListWidth(workspace.get().reviewListWidth)}
      onSize={(w, done) => set(w, done)}
      onReset={() => set(REVIEW_LIST.initial, true)}
    />
  )
}
