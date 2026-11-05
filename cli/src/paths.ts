import { createHash } from 'crypto'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

/**
 * The CLI shares the app's data folder (Electron's userData for "sldev-io"), so custom mission kinds and
 * the project context index are the same in both. Its own runtime files (socket, hook relay, MCP script
 * and endpoint) go in a `cli` folder inside it, so the app and the daemon never answer each other's agents.
 */
export function dataDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.SLDEV_DATA_DIR) return env.SLDEV_DATA_DIR
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'sldev-io')
  if (platform === 'win32') return join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'sldev-io')
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'sldev-io')
}

export const cliDir = (data = dataDir()): string => join(data, 'cli')

/** Unix sockets have a short path limit (104 bytes on macOS); a long data folder gets a socket in the temp folder. */
export function socketPath(dir = cliDir(), platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return `\\\\.\\pipe\\sldev-${createHash('sha256').update(dir).digest('hex').slice(0, 16)}`
  const p = join(dir, 'daemon.sock')
  return p.length < 100 ? p : join(tmpdir(), `sldev-${createHash('sha256').update(dir).digest('hex').slice(0, 16)}.sock`)
}
