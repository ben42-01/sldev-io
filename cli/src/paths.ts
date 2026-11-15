import { createHash } from 'crypto'
import { homedir, tmpdir } from 'os'
import { posix, win32 } from 'path'

const pathFor = (platform: NodeJS.Platform): typeof posix => (platform === 'win32' ? win32 : posix)

/** The per-user config folder of `name`: XDG on Linux, Application Support on macOS, %APPDATA% on Windows. */
function userFolder(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string {
  const { join } = pathFor(platform)
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', name)
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), name)
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), name)
}

/**
 * The CLI's own folder: its config (config.json), user mission kinds, the context index and its runtime
 * files (socket, hook relay, MCP script and endpoint). The CLI and the app share code, not state, so this is
 * never the app's folder. `SLDEV_DATA_DIR` overrides it.
 */
export function dataDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  return env.SLDEV_DATA_DIR || userFolder('sldev', env, platform, home)
}

/**
 * The sldev-io app's data folder (Electron's userData). The CLI only ever reads it, and only in
 * `sldev clean --orphans`, so it never removes a worktree the app's missions, runs or automations use.
 * `SLDEV_APP_DATA_DIR` overrides it.
 */
export function appDataDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  return env.SLDEV_APP_DATA_DIR || userFolder('sldev-io', env, platform, home)
}

/**
 * Where sldev 0.4 and older kept their runtime files: a `cli` folder in the app's data folder (or in
 * `SLDEV_DATA_DIR`, which meant the app's folder then). Only looked at to find a daemon left running there.
 */
export function legacyRuntimeDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  return pathFor(platform).join(env.SLDEV_DATA_DIR || userFolder('sldev-io', env, platform, home), 'cli')
}

/** Unix sockets have a short path limit (104 bytes on macOS); a long data folder gets a socket in the temp folder. */
export function socketPath(dir = dataDir(), platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return `\\\\.\\pipe\\sldev-${createHash('sha256').update(dir).digest('hex').slice(0, 16)}`
  const p = posix.join(dir, 'daemon.sock')
  return p.length < 100 ? p : posix.join(tmpdir(), `sldev-${createHash('sha256').update(dir).digest('hex').slice(0, 16)}.sock`)
}
