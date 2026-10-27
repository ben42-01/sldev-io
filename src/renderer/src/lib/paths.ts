import { posixQuote } from '@shared/argv'

const isWin = window.api.platform === 'win32'

export function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : p
}

export function relative(from: string, to: string): string {
  if (to === from) return '.'
  const prefix = from.endsWith('/') || from.endsWith('\\') ? from : from + (isWin ? '\\' : '/')
  return to.startsWith(prefix) ? to.slice(prefix.length) : to
}

export type ShellKind = 'posix' | 'powershell' | 'cmd'

/** Quote a path so it can be typed into a shell as a single argument (Windows terminals run PowerShell unless set to cmd). */
export function shellQuote(p: string, kind: ShellKind = isWin ? 'powershell' : 'posix'): string {
  if (kind === 'posix') return posixQuote(p)
  // cmd.exe has no escape for " inside quotes, but paths can't contain one
  if (kind === 'cmd') return /[\s&()^%!"']/.test(p) ? `"${p}"` : p
  // PowerShell single quotes are literal: no $, ` or % expansion; ' is doubled
  return /^[\w@+=:,./\\-]+$/.test(p) ? p : `'${p.replace(/'/g, "''")}'`
}

export function tildify(p: string, home: string): string {
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p
}
