import { describe, expect, it } from 'vitest'
import type { AppInfo } from '@shared/types'
import { isPlatform, pickAsset } from '../website/api/download'
import { detectPlatform } from '../website/src/lib/download'
import { diagnostics } from '@renderer/state/updates'

const asset = (name: string) => ({ name, browser_download_url: `https://dl/${name}` })
const release = (version: string, names: string[], draft = false) => ({ draft, assets: names.map((n) => asset(`sldev-io-${version}${n}`)) })

describe('website /download/<platform>', () => {
  const releases = [
    release('0.1.0-beta.4', ['-arm64.dmg'], true),
    release('0.1.0-beta.3', ['-setup.exe', '-setup.exe.blockmap', '-arm64.dmg', '-x64.dmg', '-arm64-mac.zip', '_amd64.deb', '-latest-linux.yml']),
    release('0.1.0-beta.2', ['.Setup.exe', '-arm64.dmg', '.dmg', '_amd64.deb'])
  ]

  it('picks the installer for each platform from the newest published release', () => {
    expect(pickAsset(releases, 'windows')).toBe('https://dl/sldev-io-0.1.0-beta.3-setup.exe')
    expect(pickAsset(releases, 'mac')).toBe('https://dl/sldev-io-0.1.0-beta.3-arm64.dmg')
    expect(pickAsset(releases, 'mac-intel')).toBe('https://dl/sldev-io-0.1.0-beta.3-x64.dmg')
    expect(pickAsset(releases, 'linux')).toBe('https://dl/sldev-io-0.1.0-beta.3_amd64.deb')
  })

  it('understands the older file names and falls back to older releases', () => {
    const old = releases.slice(2)
    expect(pickAsset(old, 'mac-intel')).toBe('https://dl/sldev-io-0.1.0-beta.2.dmg')
    expect(pickAsset([release('1.0.0', ['-setup.exe']), ...old], 'linux')).toBe('https://dl/sldev-io-0.1.0-beta.2_amd64.deb')
    expect(pickAsset([], 'linux')).toBeNull()
  })

  it('accepts only known platforms', () => {
    expect(isPlatform('mac-intel')).toBe(true)
    expect(isPlatform('toString')).toBe(false)
    expect(isPlatform(null)).toBe(false)
  })

  it('detects the platform from the user agent', () => {
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac')
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14)')).toBeNull()
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBeNull()
  })
})

describe('About diagnostics', () => {
  it('summarises versions and update state for support', () => {
    const info: AppInfo = { name: 'sldev-io', version: '0.1.0-beta.3', channel: 'beta', electron: '45.0.0', chrome: '156', node: '24', platform: 'linux', arch: 'x64', os: 'Linux 6.8' }
    expect(diagnostics(info, { state: 'error', version: null, percent: null, manual: false, error: 'offline', checkedAt: null })).toBe(
      'sldev-io 0.1.0-beta.3 (beta)\nElectron 45.0.0 · Chromium 156 · Node 24\nLinux 6.8 (linux x64)\nUpdates: error (offline)'
    )
  })
})
