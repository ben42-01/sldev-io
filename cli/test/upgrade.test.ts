import { mkdirSync, mkdtempSync } from 'fs'
import { createServer, type Server } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { connect, tryConnect } from '../src/client'
import { startDaemon } from '../src/daemon'
import { socketPath } from '../src/paths'
import { lineReader } from '../src/protocol'
import { VERSION } from '../src/version'
import { removeTemp } from './fakePath'

/**
 * After an upgrade, a daemon started by the old sldev is still running. 0.1.0's answered ls and attach but
 * stayed silent on `tabs` (new in 0.2.0) and anything else it didn't know, so the new `sldev` waited forever
 * on a blank screen. These fakes behave like that old daemon.
 */

const tmp = mkdtempSync(join(tmpdir(), 'sldev-upgrade-'))
let n = 0
let server: Server | null = null

afterEach(async () => {
  if (server?.listening) await new Promise<void>((r) => server!.close(() => r()))
  server = null
})
afterAll(() => removeTemp(tmp))

/**
 * A daemon of `version` with these panes: answers ping, ls and stop (and records them), ignores the rest.
 * It listens in `data`, or with `legacy` in `<data>-app/cli`, where sldev 0.4 and older ran it.
 */
async function oldDaemon(version: string, panes: object[], legacy = false): Promise<{ data: string; legacyDir: string; got: string[] }> {
  const data = join(tmp, `d${++n}`)
  const legacyDir = join(`${data}-app`, 'cli')
  const dir = legacy ? legacyDir : data
  mkdirSync(dir, { recursive: true })
  const got: string[] = []
  server = createServer((c) =>
    c.on(
      'data',
      lineReader((m) => {
        const r = m as { id: number; cmd: string }
        got.push(r.cmd)
        const reply = (result: unknown): void => void c.write(JSON.stringify({ id: r.id, ok: true, result }) + '\n')
        if (r.cmd === 'ping') reply({ version, pid: 999_999_999 })
        else if (r.cmd === 'ls' || r.cmd === 'tabs') reply(r.cmd === 'ls' ? panes : { order: [], active: null, split: false })
        else if (r.cmd === 'stop') {
          reply(null)
          // like the real one: it goes away a moment after answering
          setTimeout(() => server?.close(), 20)
          c.destroy()
        }
      })
    )
  )
  await new Promise<void>((r) => server!.listen(socketPath(dir), () => r()))
  return { data, legacyDir, got }
}

describe('a daemon left over from another version', () => {
  it('is stopped and replaced when nothing runs in it, instead of hanging', async () => {
    const old = await oldDaemon('0.1.0', [{ id: '1', title: 'old', status: 'ended' }])
    let was = ''
    // start: false, so the test doesn't spawn a real daemon: after the old one is stopped, nothing is running
    await expect(connect({ dataDir: old.data, script: '', start: false, onRestart: (w) => (was = w) })).rejects.toThrow('not running')
    expect(old.got).toEqual(['ping', 'ls', 'stop'])
    expect(was).toBe('sldev 0.1.0')
    expect(await tryConnect(socketPath(old.data))).toBeNull()
  })

  it('is left alone while it still runs panes, and the error says how to restart it', async () => {
    const old = await oldDaemon('0.2.0', [{ id: '4', title: 'fix the parser', status: 'working', pid: 123 }])
    const err = await connect({ dataDir: old.data, script: '', start: false }).catch((e: Error) => e)
    expect((err as Error).message).toMatch(/from sldev 0\.2\.0 and still runs 1 pane \(4 fix the parser\).*sldev stop/)
    expect(old.got).not.toContain('stop')
  })

  it('is reached without the check by sldev stop', async () => {
    const old = await oldDaemon('0.1.0', [{ id: '1', title: 'busy', status: 'working', pid: 1 }])
    const c = await connect({ dataDir: old.data, script: '', start: false, check: false })
    expect(old.got).toEqual([])
    await c.request('stop', {}, 1000)
    c.close()
  })

  it('times a request out instead of waiting forever on one it ignores', async () => {
    const old = await oldDaemon(VERSION, [])
    const c = await connect({ dataDir: old.data, script: '', start: false })
    await expect(c.request('loops', {}, 200)).rejects.toThrow(`didn't answer "loops"`)
    c.close()
  })
})

describe('a daemon in the old folder (sldev 0.4 ran it in the app\'s data folder)', () => {
  it('keeps serving while it runs panes, and says once that sldev moves when they are done', async () => {
    const old = await oldDaemon('0.4.1', [{ id: '2', title: 'busy', status: 'working', pid: 42 }], true)
    const notes: string[] = []
    const c = await connect({ dataDir: old.data, legacyDir: old.legacyDir, script: '', start: false, onLegacy: (m) => notes.push(m) })
    expect(await c.request('tabs', {}, 1000)).toEqual({ order: [], active: null, split: false })
    c.close()
    expect(old.got).not.toContain('stop')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/sldev 0\.4\.1 .*runs 1 pane;.*once they're done/)
  })

  it('is stopped when nothing runs in it, so the new one can start in the CLI\'s own folder', async () => {
    const old = await oldDaemon('0.4.1', [{ id: '1', title: 'old', status: 'ended' }], true)
    let was = ''
    await expect(connect({ dataDir: old.data, legacyDir: old.legacyDir, script: '', start: false, onRestart: (w) => (was = w) })).rejects.toThrow('not running')
    expect(old.got).toEqual(['ping', 'ls', 'stop'])
    expect(was).toBe('sldev 0.4.1')
    expect(await tryConnect(socketPath(old.legacyDir))).toBeNull()
  })

  it('is left alone with live panes it can\'t be trusted with (older than 0.4), and the error says why', async () => {
    const old = await oldDaemon('0.3.0', [{ id: '4', title: 'parser', status: 'working', pid: 1 }], true)
    const err = await connect({ dataDir: old.data, legacyDir: old.legacyDir, script: '', start: false }).catch((e: Error) => e)
    expect((err as Error).message).toMatch(/from sldev 0\.3\.0 and still runs 1 pane/)
    expect(old.got).not.toContain('stop')
  })

  it('is what sldev stop and clean reach when the new folder has none', async () => {
    const old = await oldDaemon('0.4.1', [{ id: '1', title: 'busy', status: 'working', pid: 1 }], true)
    const c = await connect({ dataDir: old.data, legacyDir: old.legacyDir, script: '', start: false, check: false })
    expect(old.got).toEqual([])
    c.close()
  })

  it('is not looked at while a daemon answers in the new folder', async () => {
    const data = join(tmp, 'both')
    const d = await startDaemon({ dataDir: data, notify: () => undefined })
    try {
      const old = await oldDaemon('0.4.1', [{ id: '1', title: 'busy', status: 'working', pid: 1 }], true)
      const c = await connect({ dataDir: data, legacyDir: old.legacyDir, script: '', start: false })
      expect((await c.request('ping', {}, 1000)).version).toBe(VERSION)
      c.close()
      expect(old.got).toEqual([])
    } finally {
      await d.close()
    }
  })
})

describe('this daemon', () => {
  it('answers a command it does not know with an error, never silence', async () => {
    const data = join(tmp, 'real')
    const d = await startDaemon({ dataDir: data, notify: () => undefined })
    try {
      const c = await connect({ dataDir: data, script: '', start: false })
      await expect(c.request('from-the-future' as 'ls', {}, 2000)).rejects.toThrow(`sldev ${VERSION} doesn't know "from-the-future"`)
      c.close()
    } finally {
      await d.close()
    }
  })
})
