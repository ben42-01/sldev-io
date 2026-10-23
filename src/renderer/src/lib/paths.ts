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

/** Quote a path so it can be pasted into the user's shell as a single argument. */
export function shellQuote(p: string): string {
  if (isWin) return /[\s&()^%!"']/.test(p) ? `"${p}"` : p
  return /^[\w@%+=:,./-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`
}

export function tildify(p: string, home: string): string {
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p
}
