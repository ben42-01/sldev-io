import { clampZoom, resolveTheme, type ResolvedTheme } from '@shared/theme'
import { createStore } from '../state/store'
import { workspace } from '../state/workspace'
import { setTerminalTheme } from './terminals'

/** The theme on screen now (Settings → Appearance resolved against the OS). */
export const appearance = createStore<{ theme: ResolvedTheme }>({ theme: window.api.initialTheme ?? 'dark' })

function paint(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme
  appearance.set({ theme })
  setTerminalTheme(theme)
}

/** Paint the theme main opened the window with, then follow the setting and, under "Match system", the OS. */
export function startTheme(): void {
  // what main opened the window with (theme from argv, zoom from settings): nothing to send until one changes
  let shown = { theme: appearance.get().theme, zoom: NaN }
  paint(shown.theme)
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const update = (): void => {
    const w = workspace.get()
    if (!w.ready) return
    const theme = resolveTheme(w.theme, media.matches)
    const zoom = clampZoom(w.uiZoom)
    // the first look at the settings only puts right what the window opened with (a reload keeps main's first theme)
    const first = Number.isNaN(shown.zoom)
    if (first) shown.zoom = zoom
    if (theme === shown.theme && zoom === shown.zoom) return
    if (theme !== shown.theme) {
      // one cross-fade of the whole window rather than every element's own colour transition
      // but not at startup: a transition started before the first frame never finishes, and the window stays black
      const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
      if (!first && doc.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(() => paint(theme))
      else paint(theme)
    }
    shown = { theme, zoom }
    window.api.window?.setAppearance(theme, zoom)
  }
  media.addEventListener('change', update)
  workspace.subscribe(update)
  update()
}
