import { spawn } from 'child_process'
import { findOnPath } from '../../src/main/launch'

/**
 * A native desktop notification, from argv (no shell): notify-send on Linux, osascript on macOS.
 * Nothing happens when neither is there, or with SLDEV_NOTIFY=0.
 */
export function notifyCommand(title: string, body: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] | null {
  if (env.SLDEV_NOTIFY === '0') return null
  const t = title.slice(0, 120)
  const b = body.replace(/\s+/g, ' ').slice(0, 240)
  if (platform === 'darwin') {
    // the texts are run arguments, so no AppleScript quoting is needed
    return ['osascript', '-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', t, b]
  }
  if (platform === 'linux' && findOnPath('notify-send', env)) return ['notify-send', '--app-name=sldev', t, b]
  return null
}

export function desktopNotify(title: string, body: string): void {
  const argv = notifyCommand(title, body)
  if (!argv) return
  try {
    spawn(argv[0], argv.slice(1), { stdio: 'ignore', detached: true }).on('error', () => undefined).unref()
  } catch {
    // no notifications then
  }
}
