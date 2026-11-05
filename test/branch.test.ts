import { describe, expect, it } from 'vitest'
import { branchName, branchType, cleanBranchName } from '../src/shared/branch'

describe('branchName', () => {
  it('turns a brief into a short feature branch', () => {
    expect(branchName('Add a dark mode toggle to the settings page')).toBe('feature/dark-mode-toggle-settings')
  })
  it('reads the type from the wording', () => {
    expect(branchName('Fix the crash when the terminal resizes')).toBe('fix/crash-terminal-resizes')
    expect(branchType('Update the README with install steps')).toBe('docs')
    expect(branchType('Refactor the pty module')).toBe('refactor')
    expect(branchType('Write e2e tests for missions')).toBe('test')
    expect(branchType('Bump electron to 45')).toBe('chore')
  })
  it('uses only the first line and stays short', () => {
    const b = branchName('Implement license key verification against the offline public key store\n\nLots of detail here')
    expect(b.startsWith('feature/license-key-verification')).toBe(true)
    expect(b.length).toBeLessThanOrEqual('feature/'.length + 40)
  })
  it('never ends up empty', () => {
    expect(branchName('')).toBe('feature/work')
    expect(branchName('add the')).toBe('feature/add-the')
  })
})

describe('cleanBranchName', () => {
  it('makes typed names safe for git', () => {
    expect(cleanBranchName(' feature/my new thing ')).toBe('feature/my-new-thing')
    expect(cleanBranchName('fix//a..b~^:')).toBe('fix/a.b')
    expect(cleanBranchName('-feature/x.lock')).toBe('feature/x')
  })
})
