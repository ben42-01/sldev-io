import { readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import path from 'path'
import { cmdShimCommandLine, windowsCommandLine } from '@shared/argv'

/** What node-pty spawns: on Windows `args` is a finished command line, so our quoting is the only quoting. */
export interface Launch {
  file: string
  args: string[] | string
}

/** File access, swappable so tests can describe a Windows machine. */
export interface LaunchFs {
  isFile: (p: string) => boolean
  read: (p: string) => string
}

const realFs: LaunchFs = {
  isFile: (p) => {
    try {
      return statSync(p).isFile()
    } catch {
      return false
    }
  },
  read: (p) => readFileSync(p, 'utf8')
}

/** Find a program on PATH. On Windows a real .exe anywhere on PATH wins over an npm .cmd shim. */
export function findOnPath(bin: string, env: Record<string, string | undefined>, platform = process.platform, fs = realFs): string | null {
  const win = platform === 'win32'
  const { join, extname, isAbsolute } = win ? path.win32 : path.posix
  const pathVar = (win ? (env.Path ?? env.PATH) : env.PATH) ?? ''
  const dirs = isAbsolute(bin) || /[\\/]/.test(bin) ? [''] : pathVar.split(win ? ';' : ':').filter(Boolean)
  const exts = win && !extname(bin) ? ['.exe', '.com', '.cmd', '.bat'] : ['']
  for (const ext of exts) {
    for (const dir of dirs) {
      const p = dir ? join(dir, bin + ext) : bin + ext
      if (fs.isFile(p)) return p
    }
  }
  return null
}

/**
 * The program behind an npm .cmd shim, which ends in `"%_prog%" "%dp0%\node_modules\…\cli.js" %*`
 * (or runs a target directly: `"%dp0%\…\tool.exe" %*`). Running that program ourselves keeps every
 * argument exact, which cmd.exe can't (it ends a command at the first line break).
 */
export function shimTarget(shim: string, env: Record<string, string | undefined>, fs = realFs): string[] | null {
  let text: string
  try {
    text = fs.read(shim)
  } catch {
    return null
  }
  const m = /"%(?:~)?dp0%\\?([^"]+)"\s+%\*/i.exec(text)
  if (!m) return null
  const dir = path.win32.dirname(shim)
  const target = path.win32.join(dir, m[1])
  if (!fs.isFile(target)) return null
  if (/\.(exe|com)$/i.test(target)) return [target]
  if (!/\.[cm]?js$/i.test(target)) return null
  const node = fs.isFile(path.win32.join(dir, 'node.exe')) ? path.win32.join(dir, 'node.exe') : findOnPath('node', env, 'win32', fs)
  return node ? [node, target] : null
}

/**
 * How to spawn an argv without a shell. Throws a readable error when the program isn't installed,
 * or when a multi-line prompt would have to go through cmd.exe (it would be cut at the first line).
 */
export function resolveLaunch(argv: string[], env: Record<string, string | undefined>, platform = process.platform, fs = realFs): Launch {
  const [first, ...args] = argv
  if (!first) throw new Error('Nothing to run')
  const bin = /^~[\\/]/.test(first) ? path.join(homedir(), first.slice(2)) : first
  const found = findOnPath(bin, env, platform, fs)
  if (!found) throw new Error(`${first} was not found on PATH. Install it, or check the agent's command in Settings → Agents.`)
  if (platform !== 'win32') return { file: found, args }

  if (!/\.(cmd|bat)$/i.test(found)) return { file: found, args: windowsCommandLine(args) }
  const target = shimTarget(found, env, fs)
  if (target) return { file: target[0], args: windowsCommandLine([...target.slice(1), ...args]) }
  try {
    return { file: env.ComSpec ?? env.COMSPEC ?? 'cmd.exe', args: `/d /s /c "${cmdShimCommandLine(found, args)}"` }
  } catch {
    throw new Error(`${first} is a .cmd script, and cmd.exe can't pass it a prompt with line breaks. Install ${first} as an .exe or through npm, or use a one-line prompt.`)
  }
}
