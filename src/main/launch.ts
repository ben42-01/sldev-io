import { readdirSync, readFileSync, statSync } from 'fs'
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
  /** entry names in a directory, [] when it can't be read */
  list: (dir: string) => string[]
}

const realFs: LaunchFs = {
  isFile: (p) => {
    try {
      return statSync(p).isFile()
    } catch {
      return false
    }
  },
  read: (p) => readFileSync(p, 'utf8'),
  list: (dir) => {
    try {
      return readdirSync(dir)
    } catch {
      return []
    }
  }
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

/** `2026.10.22-27dcf5f` or `2026.10.22-14-05-09-27dcf5f` as numbers to sort by; null for anything else */
function versionKey(name: string): number[] | null {
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?-[a-f0-9]+$/.exec(name)
  return m ? m.slice(1).map((n) => Number(n ?? 0)) : null
}

/**
 * Launchers that keep side-by-side versions next to them, like Cursor's agent.cmd: it runs agent.ps1,
 * which starts `versions\<newest>\node.exe index.js`. Starting that node ourselves keeps every argument
 * exact (cmd.exe cuts at a line break, Windows PowerShell drops embedded quotes).
 */
export function versionedTarget(shim: string, fs = realFs): string[] | null {
  const dir = path.win32.join(path.win32.dirname(shim), 'versions')
  const newest = fs
    .list(dir)
    .map((name) => ({ name, key: versionKey(name) }))
    .filter((v): v is { name: string; key: number[] } => !!v.key)
    .sort((a, b) => b.key.reduce((d, n, i) => d || n - a.key[i], 0))
    .map((v) => path.win32.join(dir, v.name))
    .find((v) => fs.isFile(path.win32.join(v, 'node.exe')) && fs.isFile(path.win32.join(v, 'index.js')))
  return newest ? [path.win32.join(newest, 'node.exe'), path.win32.join(newest, 'index.js')] : null
}

/** Windows PowerShell, which every Windows has (pwsh only when the user installed it). */
function windowsPowerShell(env: Record<string, string | undefined>, fs = realFs): string {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows'
  const builtin = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return fs.isFile(builtin) ? builtin : 'powershell.exe'
}

const psFileArgs = (script: string): string[] => ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script]

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
  const target = shimTarget(found, env, fs) ?? versionedTarget(found, fs)
  if (target) return { file: target[0], args: windowsCommandLine([...target.slice(1), ...args]) }
  try {
    return { file: env.ComSpec ?? env.COMSPEC ?? 'cmd.exe', args: `/d /s /c "${cmdShimCommandLine(found, args)}"` }
  } catch {
    // a PowerShell script next to the .cmd takes line breaks (embedded quotes may still be lost)
    const ps1 = found.replace(/\.(cmd|bat)$/i, '.ps1')
    if (fs.isFile(ps1)) return { file: windowsPowerShell(env, fs), args: windowsCommandLine([...psFileArgs(ps1), ...args]) }
    throw new Error(`${first} is a .cmd script, and cmd.exe can't pass it a prompt with line breaks. Install ${first} as an .exe or through npm, or use a one-line prompt.`)
  }
}

/**
 * How a typed command line (runtime, shell task) runs on Windows: through cmd.exe, except a command
 * that starts with a .ps1 script, which cmd.exe would hand to its file association (Notepad).
 */
export function windowsShellLaunch(command: string, env: Record<string, string | undefined>, powershell?: string, fs = realFs): Launch {
  const m = /^\s*(?:&\s*)?(?:"([^"]+\.ps1)"|'([^']+\.ps1)'|([^\s"'&|<>]+\.ps1))(?=\s|$)(.*)$/is.exec(command)
  if (m) {
    const script = m[1] ?? m[2] ?? m[3]
    return { file: powershell ?? windowsPowerShell(env, fs), args: `${windowsCommandLine(psFileArgs(script))}${m[4]}` }
  }
  // verbatim: as an array node-pty would turn every " in the command into \", which cmd.exe misreads
  return { file: env.ComSpec ?? env.COMSPEC ?? 'cmd.exe', args: `/d /s /c "${command}"` }
}
