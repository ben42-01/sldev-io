import { describe, expect, it } from 'vitest'
import { resolveTheme, THEME_ARG, themeFromArgv, WINDOW_COLORS } from '../src/shared/theme'

describe('resolveTheme', () => {
  it('is dark by default and for unknown values', () => {
    expect(resolveTheme(undefined, false)).toBe('dark')
    expect(resolveTheme(null, false)).toBe('dark')
    expect(resolveTheme('sepia' as never, false)).toBe('dark')
  })
  it('keeps a fixed choice whatever the OS does', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
  it('follows the OS under system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('the window theme argument', () => {
  it('round-trips through argv, so the preload paints the theme main chose', () => {
    expect(themeFromArgv(['electron', '--foo', `${THEME_ARG}light`])).toBe('light')
    expect(themeFromArgv(['electron', `${THEME_ARG}dark`])).toBe('dark')
  })
  it('is dark when the argument is missing or garbled', () => {
    expect(themeFromArgv(['electron'])).toBe('dark')
    expect(themeFromArgv([`${THEME_ARG}purple`])).toBe('dark')
  })
  it('has window colours for both themes', () => {
    expect(WINDOW_COLORS.dark.background).toMatch(/^#[0-9a-f]{6}$/)
    expect(WINDOW_COLORS.light.background).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('interface size', () => {
  it('keeps stored zooms within the offered range and repairs broken ones', async () => {
    const { clampZoom, titleBarHeight, UI_ZOOMS } = await import('../src/shared/theme')
    expect(clampZoom(1.1)).toBe(1.1)
    expect(clampZoom(3)).toBe(1.25)
    expect(clampZoom(0.2)).toBe(0.9)
    expect(clampZoom(undefined)).toBe(1)
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(clampZoom('1.1')).toBe(1)
    for (const z of UI_ZOOMS) expect(clampZoom(z.value)).toBe(z.value)
    expect(titleBarHeight(1)).toBe(36)
    expect(titleBarHeight(1.25)).toBe(45)
  })
})
