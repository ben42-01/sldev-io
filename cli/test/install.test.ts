import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, type Client } from '../src/client'
import { adoptPath, startDaemon, type Daemon } from '../src/daemon'
import { removeTemp } from './fakePath'

/**
 * An agent installed while the daemon runs: someone picked one that wasn't installed, ran its install command
 * and picked it again, and the daemon still said it wasn't there (it only looked when it started).
 */

const tmp = mkdtempSync(join(tmpdir(), 'sldev-install-'))
const data = join(tmp, 'data')
const work = join(tmp, 'work')
/** on the daemon's PATH from the start, empty until the "install" */
const onPath = join(tmp, 'bin')
/** only on the PATH of the shell the person runs sldev from next (an installer added it to their profile) */
const newShellBin = join(tmp, 'new-bin')
let daemon: Daemon
let c: Client
let savedPath: string | undefined

const install = (dir: string, name: string): void => {
  const file = join(dir, name)
  writeFileSync(file, '#!/bin/sh\necho "late agent here"\nsleep 30\n')
  chmodSync(file, 0o755)
}

beforeAll(async () => {
  savedPath = process.env.PATH
  for (const d of [data, work, onPath, newShellBin]) mkdirSync(d, { recursive: true })
  writeFileSync(join(data, 'config.json'), JSON.stringify({ customAgents: [{ id: 'late', command: 'late-agent' }, { id: 'later', command: 'later-agent' }] }))
  process.env.PATH = [onPath, savedPath].join(delimiter)
  daemon = await startDaemon({ dataDir: data, notify: () => undefined })
  c = await connect({ dataDir: data, script: '', start: false })
})

afterAll(async () => {
  for (const p of await c.request('ls', {}).catch(() => [])) await c.request('kill', { pane: p.id }).catch(() => undefined)
  c?.close()
  await daemon?.close()
  process.env.PATH = savedPath
  removeTemp(tmp)
})

describe('an agent installed while the daemon runs', () => {
  it.skipIf(process.platform === 'win32')('is found in a folder already on PATH, and in one only the asking shell has', async () => {
    await expect(c.request('new', { agent: 'late', brief: '', cwd: work })).rejects.toThrow("isn't installed")
    install(onPath, 'late-agent')
    const late = await c.request('new', { agent: 'late', brief: '', cwd: work })
    expect(late.agentName).toBe('late')

    // the daemon's PATH doesn't have the folder; the sldev that asks does, and says so
    install(newShellBin, 'later-agent')
    await expect(c.request('new', { agent: 'later', brief: '', cwd: work, path: process.env.PATH })).rejects.toThrow("isn't installed")
    const later = await c.request('new', { agent: 'later', brief: '', cwd: work, path: [newShellBin, process.env.PATH].join(delimiter) })
    expect(later.agentName).toBe('later')
    // the folder went after the daemon's own, so nothing it already found changes
    expect(process.env.PATH!.split(delimiter).at(-1)).toBe(newShellBin)
  })
})

describe('adoptPath', () => {
  it('adds only absolute folders the daemon lacks, after its own, once', () => {
    const env: NodeJS.ProcessEnv = { PATH: ['/a', '/b'].join(delimiter) }
    adoptPath(['/c', '/a', 'relative', '', '/c', '/d'].join(delimiter), env)
    expect(env.PATH).toBe(['/a', '/b', '/c', '/d'].join(delimiter))
    adoptPath(undefined, env)
    adoptPath(['/a'].join(delimiter), env)
    expect(env.PATH).toBe(['/a', '/b', '/c', '/d'].join(delimiter))
  })
})
