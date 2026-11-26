import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from '@shared/types'
import { downloadPlatform, installKind, installText, restartDetail, updateToast } from '@shared/updates'

const status = (patch: Partial<UpdateStatus>): UpdateStatus => ({
  state: 'idle',
  version: null,
  percent: null,
  manual: false,
  install: 'appimage',
  error: null,
  checkedAt: null,
  ...patch
})

describe('install kind', () => {
  const linux = { packaged: true, platform: 'linux' as const, packageType: null }

  it('tells the AppImage, the .deb and other Linux builds apart', () => {
    expect(installKind({ ...linux, appImage: '/home/u/Applications/sldev-io.AppImage' })).toBe('appimage')
    // the AppImage wins even if a package-type file came along
    expect(installKind({ ...linux, appImage: '/x.AppImage', packageType: 'deb' })).toBe('appimage')
    expect(installKind({ ...linux, packageType: 'deb\n' })).toBe('deb')
    expect(installKind({ ...linux, packageType: 'rpm' })).toBe('linux')
    expect(installKind(linux)).toBe('linux')
  })

  it('never updates development builds', () => {
    expect(installKind({ ...linux, packaged: false, appImage: '/x.AppImage' })).toBe('dev')
    expect(installKind({ packaged: true, platform: 'win32', packageType: null })).toBe('windows')
    expect(installKind({ packaged: true, platform: 'darwin', packageType: null })).toBe('mac')
  })
})

describe('what an update does', () => {
  it('says the AppImage needs no password and the .deb does', () => {
    expect(installText(status({ install: 'appimage' })).update).toContain('No password needed')
    expect(installText(status({ install: 'deb' })).update).toContain('administrator password')
    expect(installText(status({ install: 'deb', manual: true })).update).toContain('Download gets the new .deb')
    expect(installText(status({ install: 'appimage', manual: true })).update).toContain("can't write to")
    expect(installText(status({ install: 'linux' })).update).toContain("can't update itself")
  })

  it('explains the password prompt before the .deb restart asks for it', () => {
    const deb = restartDetail('deb', 'https://site')
    expect(deb).toContain('administrator password')
    expect(deb).toContain('curl -fsSL https://site/install.sh | sh')
    expect(restartDetail('appimage', 'https://site')).not.toContain('password')
  })

  it('toasts what happens next once an update is ready or out', () => {
    expect(updateToast(status({ state: 'ready', version: '1.1.0', install: 'deb' }))).toContain('administrator password')
    expect(updateToast(status({ state: 'ready', version: '1.1.0', install: 'appimage' }))).toContain('no password')
    expect(updateToast(status({ state: 'available', version: '1.1.0', install: 'deb', manual: true }))).toContain('Settings → About → Download')
    expect(updateToast(status({ state: 'downloading', version: '1.1.0' }))).toBeNull()
    expect(updateToast(status({ state: 'ready', version: null }))).toBeNull()
  })

  it('sends manual updates to the matching download', () => {
    expect(downloadPlatform('mac', 'arm64')).toBe('mac')
    expect(downloadPlatform('mac', 'x64')).toBe('mac-intel')
    expect(downloadPlatform('deb', 'x64')).toBe('linux')
    expect(downloadPlatform('appimage', 'x64')).toBe('linux-appimage')
  })
})
