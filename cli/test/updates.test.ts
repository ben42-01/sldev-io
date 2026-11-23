import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { parseConfig } from '../src/config'
import { compareVersions, fetchLatest, isNewer, markAnnounced, updateCheckOff, updateToAnnounce } from '../src/updates'

const DAY = 24 * 60 * 60 * 1000
const T = 10 * DAY

describe('the update check', () => {
  it('compares versions by number, a prerelease before its release', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('0.6.1', '0.6.1')).toBe(0)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(isNewer('0.6.2', '0.6.1')).toBe(true)
    expect(isNewer('0.6.0', '0.6.1')).toBe(false)
    expect(isNewer('garbage', '0.6.1')).toBe(false)
    expect(isNewer(null, '0.6.1')).toBe(false)
  })

  it('asks the registry at most once a day, and tells about each new version once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sldev-update-'))
    let asked = 0
    let latest: string | null = '0.7.0'
    const ask = async (): Promise<string | null> => (asked++, latest)
    expect(await updateToAnnounce(dir, { now: T, fetchLatest: ask, current: '0.6.1' })).toBe('0.7.0')
    markAnnounced(dir, '0.7.0')
    expect(await updateToAnnounce(dir, { now: T + 1000, fetchLatest: ask, current: '0.6.1' })).toBeNull()
    expect(asked).toBe(1)
    // a day on, a newer one is told about; a failed ask keeps the last answer and still waits a day
    latest = '0.8.0'
    expect(await updateToAnnounce(dir, { now: T + DAY, fetchLatest: ask, current: '0.6.1' })).toBe('0.8.0')
    latest = null
    expect(await updateToAnnounce(dir, { now: T + 2 * DAY, fetchLatest: ask, current: '0.6.1' })).toBe('0.8.0')
    expect(asked).toBe(3)
    expect(JSON.parse(readFileSync(join(dir, 'update.json'), 'utf8'))).toMatchObject({ checkedAt: T + 2 * DAY, latest: '0.8.0' })
    // already on it: nothing to say
    expect(await updateToAnnounce(dir, { now: T + 2 * DAY, fetchLatest: ask, current: '0.8.0' })).toBeNull()
  })

  it('reads only a version from the registry, and any failure is null', async () => {
    const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
    expect(await fetchLatest(answer(200, { version: '0.7.0' }))).toBe('0.7.0')
    expect(await fetchLatest(answer(200, { version: '<script>' }))).toBeNull()
    expect(await fetchLatest(answer(404, {}))).toBeNull()
    expect(await fetchLatest((async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBeNull()
  })

  it('is off by config, SLDEV_NO_UPDATE_CHECK or CI', () => {
    expect(parseConfig({}).updateCheck).toBe(true)
    expect(parseConfig({ updateCheck: false }).updateCheck).toBe(false)
    expect(updateCheckOff({}, true)).toBe(false)
    expect(updateCheckOff({}, false)).toBe(true)
    expect(updateCheckOff({ SLDEV_NO_UPDATE_CHECK: '1' }, true)).toBe(true)
    expect(updateCheckOff({ CI: 'true' }, true)).toBe(true)
  })
})
