import type { Platform } from '../../api/download'
import { site } from './site'

export type { Platform }

export const installCommand = `curl -fsSL ${site.url}/install.sh | sh`

export const platformLabels: Record<Platform, string> = {
  windows: 'Windows',
  mac: 'macOS',
  'mac-intel': 'macOS (Intel)',
  linux: 'Linux'
}

/** Served by api/download.ts: redirects to the newest installer for the platform. */
export function downloadHref(platform: Platform): string {
  return `/download/${platform}`
}

/**
 * The visitor's platform from the user agent, or null on phones and anything else we don't build
 * for. Browsers don't reliably tell Apple Silicon from Intel, so Macs get the Apple Silicon build
 * and the download section offers the Intel one next to it.
 */
export function detectPlatform(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): Platform | null {
  if (/android|iphone|ipad|ipod/i.test(ua)) return null
  if (/windows/i.test(ua)) return 'windows'
  if (/mac os x|macintosh/i.test(ua)) return 'mac'
  if (/linux|x11/i.test(ua)) return 'linux'
  return null
}
