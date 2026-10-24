import { describe, expect, it } from 'vitest'
import type { SetupReport } from '../src/shared/types'
import { detectPackageManager, installCommand, TOOLS } from '../src/main/setup'
import { agentInstallCommand, blockers, shouldOpenSetup } from '../src/renderer/src/lib/setup'

const tool = (id: string): (typeof TOOLS)[number] => TOOLS.find((t) => t.id === id)!
const has = (...bins: string[]) => (b: string): boolean => bins.includes(b)

describe('detectPackageManager', () => {
  it('picks the first Linux manager on PATH', () => {
    expect(detectPackageManager('linux', has('dnf', 'zypper'))).toBe('dnf')
    expect(detectPackageManager('linux', has('apt-get'))).toBe('apt')
    expect(detectPackageManager('linux', has())).toBeNull()
  })
  it('uses Homebrew on macOS and winget on Windows', () => {
    expect(detectPackageManager('darwin', has('brew', 'apt-get'))).toBe('brew')
    expect(detectPackageManager('darwin', has())).toBeNull()
    expect(detectPackageManager('win32', has('winget'))).toBe('winget')
  })
})

describe('installCommand', () => {
  it('maps package names per manager', () => {
    expect(installCommand(tool('gh'), 'linux', 'pacman')).toBe('sudo pacman -S --needed github-cli')
    expect(installCommand(tool('docker'), 'linux', 'apt')).toBe('sudo apt-get install -y docker.io')
    expect(installCommand(tool('git'), 'win32', 'winget')).toContain('Git.Git')
  })
  it('falls back to the macOS command without Homebrew', () => {
    expect(installCommand(tool('git'), 'darwin', null)).toBe('xcode-select --install')
    expect(installCommand(tool('gh'), 'darwin', null)).toBeUndefined()
  })
  it('has nothing to run without a package manager on Linux', () => {
    expect(installCommand(tool('git'), 'linux', null)).toBeUndefined()
  })
})

describe('startup', () => {
  const report = (state: 'ok' | 'missing'): SetupReport => ({
    platform: 'linux',
    packageManager: 'apt',
    checks: [
      { id: 'git', name: 'Git', why: '', level: 'required', state, docs: '' },
      { id: 'gh', name: 'GitHub CLI', why: '', level: 'recommended', state: 'missing', docs: '' }
    ]
  })
  it('opens on first run, then only when something required is missing', () => {
    expect(shouldOpenSetup(report('ok'), false)).toBe(true)
    expect(shouldOpenSetup(report('ok'), true)).toBe(false)
    expect(shouldOpenSetup(report('missing'), true)).toBe(true)
    expect(blockers(report('missing')).map((c) => c.id)).toEqual(['git'])
  })
  it('hides shell-pipe agent installers on Windows', () => {
    expect(agentInstallCommand('curl https://cursor.com/install -fsS | bash', 'win32')).toBeUndefined()
    expect(agentInstallCommand('curl https://cursor.com/install -fsS | bash', 'linux')).toContain('curl')
    expect(agentInstallCommand('npm i -g @openai/codex', 'win32')).toBe('npm i -g @openai/codex')
  })
})
