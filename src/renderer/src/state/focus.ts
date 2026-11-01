import { createStore } from './store'
import { updateSettings, workspace } from './workspace'

/**
 * Review focus: while a review tab in focus mode is on screen, both sidebars step aside so the diff gets
 * the whole window. Not persisted: it ends when the review tab is hidden or closed.
 */
export const reviewFocus = createStore<{ panel: string | null }>({ panel: null })

let hidden: { left: boolean; right: boolean } | null = null

/** Focus mode: both sidebars out of the way for the dock, and back to how they were on the second press. */
export function toggleFocusMode(): void {
  const w = workspace.get()
  if (w.sidebarVisible || w.rightPanelVisible) {
    hidden = { left: w.sidebarVisible, right: w.rightPanelVisible }
    updateSettings({ sidebarVisible: false, rightPanelVisible: false })
  } else {
    updateSettings({ sidebarVisible: hidden?.left ?? true, rightPanelVisible: hidden?.right ?? true })
    hidden = null
  }
}

/** The user asked for a sidebar while a review had them hidden: show it; the review tab hides them again next time it's opened. */
export function releaseReviewFocus(): void {
  if (reviewFocus.get().panel) reviewFocus.set({ panel: null })
}
