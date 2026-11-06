import { app } from 'electron'
import { execFile } from 'child_process'
import { createHash, randomUUID } from 'crypto'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { promisify } from 'util'

const run = promisify(execFile)

async function osMachineId(): Promise<string | null> {
  try {
    if (process.platform === 'linux') {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        const id = (await fsp.readFile(f, 'utf8').catch(() => '')).trim()
        if (id) return id
      }
    } else if (process.platform === 'darwin') {
      const { stdout } = await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])
      return /"IOPlatformUUID" = "([^"]+)"/.exec(stdout)?.[1] ?? null
    } else if (process.platform === 'win32') {
      const { stdout } = await run('reg', ['query', 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true })
      return /MachineGuid\s+REG_SZ\s+(\S+)/.exec(stdout)?.[1] ?? null
    }
  } catch {
    // fall through to the stored id
  }
  return null
}

let cached: Promise<string> | null = null

/**
 * A stable per-machine hash for license activations. Only the hash leaves the machine, salted so
 * it can't be matched with other apps' ids. Without an OS id, a random one is kept in userData.
 */
export function machineHash(): Promise<string> {
  cached ??= (async () => {
    let id = await osMachineId()
    if (!id) {
      const file = join(app.getPath('userData'), 'machine-id')
      id = (await fsp.readFile(file, 'utf8').catch(() => '')).trim()
      if (!id) await fsp.writeFile(file, (id = randomUUID()))
    }
    return createHash('sha256').update(`sldev-io:${id}`).digest('hex')
  })()
  return cached
}
