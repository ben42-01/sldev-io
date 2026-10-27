import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { released, unseenChanges, type ChangelogEntry } from '@shared/changelog'
import { feedbackUrl } from '@renderer/state/updates'
import changelog from '../website/src/content/changelog.json'

const entry = (version: string, date: string | null = '2026-10-01'): ChangelogEntry => ({ version, date, changes: [`${version} change`] })
const log = [entry('0.3.0', null), entry('0.2.0'), entry('0.1.1'), entry('0.1.0')]
const versions = (l: ChangelogEntry[]): string[] => l.map((e) => e.version)

describe("What's new", () => {
  it('lists every release since the last one that ran, up to the current one', () => {
    expect(versions(unseenChanges(log, '0.3.0', '0.1.0'))).toEqual(['0.3.0', '0.2.0', '0.1.1'])
    expect(versions(unseenChanges(log, '0.2.0', '0.1.1'))).toEqual(['0.2.0'])
    expect(versions(unseenChanges(log, '0.3.0', '0.0.9'))).toEqual(['0.3.0', '0.2.0', '0.1.1', '0.1.0'])
  })

  it('shows nothing on a first launch, the same version, a downgrade or an unknown version', () => {
    expect(unseenChanges(log, '0.3.0', null)).toEqual([])
    expect(unseenChanges(log, '0.2.0', '0.2.0')).toEqual([])
    expect(unseenChanges(log, '0.1.1', '0.2.0')).toEqual([])
    expect(unseenChanges(log, '9.9.9', '0.1.0')).toEqual([])
  })

  it('keeps unreleased entries off the website', () => {
    expect(versions(released(log))).toEqual(['0.2.0', '0.1.1', '0.1.0'])
  })

  it('has an entry for the app version, and only the newest entry may be undated', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
    const log = changelog as ChangelogEntry[]
    expect(versions(log)).toContain(pkg.version)
    expect(log.slice(1).every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? ''))).toBe(true)
  })
})

describe('Report a bug', () => {
  it('opens a new issue on the public downloads repo with the diagnostics', () => {
    const info = { name: 'sldev-io', version: '0.1.0-beta.5', channel: 'beta' as const, electron: '45', chrome: '156', node: '24', platform: 'linux', arch: 'x64', os: 'Linux 6.8' }
    const url = new URL(feedbackUrl(info, null))
    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/ben42-01/downloads.sldev.io/issues/new')
    expect(url.searchParams.get('body')).toContain('sldev-io 0.1.0-beta.5 (beta)\nElectron 45')
    expect(new URL(feedbackUrl(null, null)).searchParams.get('body')).not.toContain('```')
  })
})

describe('website version', () => {
  it('matches the app version, so the site never advertises an old release', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
    const site = JSON.parse(readFileSync('website/src/content/site.json', 'utf8')) as { version: string }
    expect(site.version).toBe(pkg.version)
  })
})
