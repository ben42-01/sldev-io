/**
 * Agents are started from an argv array, never from a command string: the prompt is one array
 * element from the renderer to the spawned process. Building one string and handing it to a shell
 * broke on Windows (cmd.exe doesn't understand `\"`, so Claude got the prompt "need").
 *
 * This module holds the pure quoting rules; src/main/launch.ts picks which one applies.
 */

/**
 * Split a user-typed argument string (extra args, custom agent templates) into words: whitespace
 * separates, '…' and "…" group, a backslash escapes the next character outside single quotes.
 */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let inWord = false
  let quote: '"' | "'" | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && (s[i + 1] === '"' || s[i + 1] === '\\')) cur += s[++i]
      else cur += c
    } else if (c === '"' || c === "'") {
      quote = c
      inWord = true
    } else if (c === '\\' && i + 1 < s.length && !/[A-Za-z0-9_.:]/.test(s[i + 1])) {
      // a backslash before a letter is kept, so Windows paths like C:\tools\agent.exe survive
      cur += s[++i]
      inWord = true
    } else if (/\s/.test(c)) {
      if (inWord) out.push(cur)
      cur = ''
      inWord = false
    } else {
      cur += c
      inWord = true
    }
  }
  if (inWord) out.push(cur)
  return out
}

/** Quote one argument for a POSIX shell (only when needed). */
export function posixQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`
}

/**
 * Quote one argument so CommandLineToArgvW (and the C runtime, which every .exe uses) reads it back
 * exactly: wrap in quotes when needed, double the backslashes in front of a quote or the closing quote.
 */
export function quoteWindowsArg(arg: string): string {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg
  let out = '"'
  let slashes = 0
  for (const c of arg) {
    if (c === '\\') {
      slashes++
      continue
    }
    if (c === '"') out += '\\'.repeat(slashes * 2 + 1) + '"'
    else out += '\\'.repeat(slashes) + c
    slashes = 0
  }
  return out + '\\'.repeat(slashes * 2) + '"'
}

export function windowsCommandLine(args: string[]): string {
  return args.map(quoteWindowsArg).join(' ')
}

const CMD_META = /([()\][%!^"`<>&|;, *?])/g

/**
 * The command line for `cmd.exe /d /s /c "<this>"` that runs a .cmd/.bat shim with exact arguments
 * (the cross-spawn rules: quote for the C runtime, then caret-escape cmd's metacharacters twice,
 * because the shim's %* expands them once more). cmd.exe ends a command at a line break, so
 * multi-line arguments can't go through it at all.
 */
export function cmdShimCommandLine(shim: string, args: string[]): string {
  if (args.some((a) => /[\r\n]/.test(a))) throw new Error('multi-line argument')
  const escapeArg = (a: string): string =>
    `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`.replace(CMD_META, '^$1').replace(CMD_META, '^$1')
  return [shim.replace(CMD_META, '^$1'), ...args.map(escapeArg)].join(' ')
}

/** A readable one-line version of an argv, for the terminal echo, previews and "Copy command". */
export function formatArgv(argv: string[], platform: string): string {
  return argv.map(platform === 'win32' ? quoteWindowsArg : posixQuote).join(' ')
}
