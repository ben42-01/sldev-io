import { spawn } from 'child_process'
import { findOnPath } from '../../src/main/launch'

/**
 * A Windows toast from Windows PowerShell (its WinRT types; pwsh has none). The texts come in through the
 * environment, so nothing the agent wrote is ever parsed as PowerShell. It shows under PowerShell's own app
 * id, because Windows drops toasts from an app id nobody registered.
 */
const TOAST = [
  "$ErrorActionPreference = 'Stop'",
  '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
  '$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
  "$t = $x.GetElementsByTagName('text')",
  '$t.Item(0).AppendChild($x.CreateTextNode($env:SLDEV_NOTE_TITLE)) > $null',
  '$t.Item(1).AppendChild($x.CreateTextNode($env:SLDEV_NOTE_BODY)) > $null',
  "$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
  '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))'
].join('; ')

export interface NotifyCommand {
  argv: string[]
  /** extra environment: the texts, for the Windows toast */
  env?: Record<string, string>
}

/**
 * A native desktop notification, from argv (no shell): notify-send on Linux, osascript on macOS, a toast
 * through Windows PowerShell on Windows. Nothing happens when there's none, or with SLDEV_NOTIFY=0.
 */
export function notifyCommand(title: string, body: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): NotifyCommand | null {
  if (env.SLDEV_NOTIFY === '0') return null
  const t = title.slice(0, 120)
  const b = body.replace(/\s+/g, ' ').slice(0, 240)
  if (platform === 'darwin') {
    // the texts are run arguments, so no AppleScript quoting is needed
    return { argv: ['osascript', '-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', t, b] }
  }
  if (platform === 'linux' && findOnPath('notify-send', env)) return { argv: ['notify-send', '--app-name=sldev', t, b] }
  if (platform === 'win32') {
    return { argv: ['powershell.exe', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', TOAST], env: { SLDEV_NOTE_TITLE: t, SLDEV_NOTE_BODY: b } }
  }
  return null
}

export function desktopNotify(title: string, body: string): void {
  const cmd = notifyCommand(title, body)
  if (!cmd) return
  try {
    const { argv } = cmd
    spawn(argv[0], argv.slice(1), { stdio: 'ignore', detached: true, windowsHide: true, env: { ...process.env, ...cmd.env } }).on('error', () => undefined).unref()
  } catch {
    // no notifications then
  }
}
