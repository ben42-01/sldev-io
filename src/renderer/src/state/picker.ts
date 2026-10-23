import { createStore } from './store'

export interface PickItem {
  id: string
  label: string
  detail?: string
  category?: string
  kbd?: string
  run: () => void
  /** Alt+Enter */
  alt?: () => void
  /** Ctrl/Cmd+Enter */
  ctrl?: () => void
}

interface PickerState {
  open: boolean
  placeholder: string
  hint?: string
  items: PickItem[] | null
}

export const picker = createStore<PickerState>({ open: false, placeholder: '', items: null })

/** Open the picker. `items` may be a promise (shown as loading until it resolves). */
export function showPicker(opts: { placeholder: string; hint?: string; items: PickItem[] | Promise<PickItem[]> }): void {
  const sync = Array.isArray(opts.items)
  picker.set({ open: true, placeholder: opts.placeholder, hint: opts.hint, items: sync ? (opts.items as PickItem[]) : null })
  if (!sync) void (opts.items as Promise<PickItem[]>).then((items) => picker.get().open && picker.set({ items }))
}

export const closePicker = (): void => picker.set({ open: false, items: null })
