import { spawn } from 'child_process'
import { findOnPath } from '../../src/main/launch'

/**
 * Text to the system clipboard: the platform's own tool (wl-copy on Wayland, xclip or xsel on X11, pbcopy,
 * clip.exe), fed through stdin. Nothing to the network. Over SSH there's no display to copy to; the TUI
 * also sends OSC 52, which terminals that support it turn into a copy on the user's own machine.
 */
export function clipboardCommand(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] | null {
  if (platform === 'darwin') return ['pbcopy']
  if (platform === 'win32') return ['clip']
  const has = (bin: string): boolean => !!findOnPath(bin, env)
  if (env.WAYLAND_DISPLAY && has('wl-copy')) return ['wl-copy']
  if (env.DISPLAY && has('xclip')) return ['xclip', '-selection', 'clipboard']
  if (env.DISPLAY && has('xsel')) return ['xsel', '--clipboard', '--input']
  return null
}

/** Resolves true once the tool took the text, false when there's no tool (OSC 52 is then the only copy). */
export function copyToClipboard(text: string): Promise<boolean> {
  const cmd = clipboardCommand()
  if (!cmd) return Promise.resolve(false)
  return new Promise((resolve) => {
    // wl-copy and xclip stay in the background to serve the clipboard: don't wait for them to exit
    const p = spawn(cmd[0], cmd.slice(1), { stdio: ['pipe', 'ignore', 'ignore'], detached: process.platform !== 'win32', windowsHide: true })
    p.on('error', () => resolve(false))
    p.stdin.on('error', () => resolve(false))
    p.stdin.end(text, () => resolve(true))
    p.unref()
  })
}

/** OSC 52: asks the terminal itself to put `text` on the clipboard (works over SSH where the terminal allows it). */
export const osc52 = (text: string): string => `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`
