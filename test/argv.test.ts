import { spawnSync } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { cmdShimCommandLine, formatArgv, posixQuote, quoteWindowsArg, splitArgs, windowsCommandLine } from '@shared/argv'
import { findOnPath, resolveLaunch, shimTarget, versionedTarget, windowsShellLaunch, type LaunchFs } from '../src/main/launch'

/** The prompt that once reached Claude on Windows as the single word "need". */
const NASTY = [
  'I need you to create a document',
  `with "double" and 'single' quotes & ampersands | pipes > redirects ^ carets`,
  '%PATH% and $HOME and `backticks` and !bang!',
  'non-ASCII: café, naïve, 日本語, emoji 🚀',
  'ends with a backslash \\'
].join('\n')

/** How the C runtime / CommandLineToArgvW split a command line (arguments after the program name). */
function parseWindowsArgs(line: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < line.length) {
    while (line[i] === ' ' || line[i] === '\t') i++
    if (i >= line.length) break
    let cur = ''
    let quoted = false
    for (; i < line.length; i++) {
      const c = line[i]
      if (c === '\\') {
        let n = 0
        while (line[i] === '\\') {
          n++
          i++
        }
        if (line[i] === '"') {
          cur += '\\'.repeat(Math.floor(n / 2))
          if (n % 2) cur += '"'
          else quoted = !quoted
        } else {
          cur += '\\'.repeat(n)
          i--
        }
      } else if (c === '"') quoted = !quoted
      else if ((c === ' ' || c === '\t') && !quoted) break
      else cur += c
    }
    out.push(cur)
  }
  return out
}

describe('Windows quoting', () => {
  const cases = ['plain', '', 'two words', 'a"b', 'trailing\\', 'trailing space\\', 'a\\\\"b', '\\\\server\\share\\x y', '"already quoted"', NASTY]

  it('round-trips every argument through CommandLineToArgvW exactly', () => {
    for (const arg of cases) expect(parseWindowsArgs(quoteWindowsArg(arg))).toEqual([arg])
    expect(parseWindowsArgs(windowsCommandLine(cases))).toEqual(cases)
  })

  it('leaves simple arguments readable', () => {
    expect(quoteWindowsArg('--model')).toBe('--model')
    expect(quoteWindowsArg('C:\\tools\\x.exe')).toBe('C:\\tools\\x.exe')
    expect(quoteWindowsArg('two words')).toBe('"two words"')
  })

  it('refuses multi-line arguments for cmd.exe instead of cutting them', () => {
    expect(() => cmdShimCommandLine('C:\\bin\\agent.cmd', ['line 1\nline 2'])).toThrow()
    // quoted for the C runtime, then caret-escaped twice (cmd.exe, then the shim's %*)
    expect(cmdShimCommandLine('C:\\bin\\agent.cmd', ['a & b'])).toBe('C:\\bin\\agent.cmd ^^^"a^^^ ^^^&^^^ b^^^"')
  })
})

describe('splitArgs', () => {
  it('splits like a shell, keeping quoted groups and Windows paths', () => {
    expect(splitArgs(`--no-git  --message "two words" 'it''s' a\\ b`)).toEqual(['--no-git', '--message', 'two words', 'its', 'a b'])
    expect(splitArgs('C:\\tools\\agent.exe --x')).toEqual(['C:\\tools\\agent.exe', '--x'])
    expect(splitArgs('--empty ""')).toEqual(['--empty', ''])
    expect(splitArgs('   ')).toEqual([])
  })
})

describe('formatArgv', () => {
  it('shows an argv as a line for the platform shell', () => {
    expect(formatArgv(['claude', '-n', 'Fix bug', "don't"], 'linux')).toBe(`claude -n 'Fix bug' 'don'\\''t'`)
    expect(formatArgv(['claude', '-n', 'Fix bug'], 'win32')).toBe('claude -n "Fix bug"')
    expect(posixQuote('plain-1.txt')).toBe('plain-1.txt')
  })
})

describe('resolveLaunch on Windows', () => {
  const files: Record<string, string> = {
    'C:\\npm\\codex.cmd': '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
    'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js': '',
    'C:\\node\\node.exe': '',
    'C:\\npm\\claude.cmd': 'old shim',
    'C:\\Users\\me\\.local\\bin\\claude.exe': '',
    'C:\\tools\\weird.cmd': '@echo off\r\nsomething %*\r\n',
    'C:\\tools\\pwshy.cmd': '@echo off\r\npowershell -File "%~dp0pwshy.ps1" %*\r\n',
    'C:\\tools\\pwshy.ps1': '',
    // Cursor's Windows install: agent.cmd → agent.ps1 → versions\<newest>\node.exe index.js
    'C:\\cursor\\agent.cmd': '@echo off\r\npowershell.exe -NoProfile -File "%SCRIPT_DIR%\\cursor-agent.ps1" %*\r\n',
    'C:\\cursor\\agent.ps1': '',
    'C:\\cursor\\versions\\2026.9.30-aaaaaaa\\node.exe': '',
    'C:\\cursor\\versions\\2026.9.30-aaaaaaa\\index.js': '',
    'C:\\cursor\\versions\\2026.10.22-27dcf5f\\node.exe': '',
    'C:\\cursor\\versions\\2026.10.22-27dcf5f\\index.js': '',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe': ''
  }
  const fs: LaunchFs = {
    isFile: (p) => p in files,
    read: (p) => {
      if (!(p in files)) throw new Error('ENOENT')
      return files[p]
    },
    list: (dir) => [...new Set(Object.keys(files).filter((f) => f.startsWith(dir + '\\')).map((f) => f.slice(dir.length + 1).split('\\')[0]))]
  }
  const env = { Path: 'C:\\npm;C:\\Users\\me\\.local\\bin;C:\\node;C:\\tools;C:\\cursor', ComSpec: 'C:\\Windows\\system32\\cmd.exe', SystemRoot: 'C:\\Windows' }
  const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

  it('prefers a real .exe over an npm shim earlier on PATH, and passes the prompt as one argument', () => {
    expect(findOnPath('claude', env, 'win32', fs)).toBe('C:\\Users\\me\\.local\\bin\\claude.exe')
    const l = resolveLaunch(['claude', '-n', 'I need you', NASTY], env, 'win32', fs)
    expect(l.file).toBe('C:\\Users\\me\\.local\\bin\\claude.exe')
    expect(typeof l.args).toBe('string')
    expect(parseWindowsArgs(l.args as string)).toEqual(['-n', 'I need you', NASTY])
  })

  it('runs the script behind an npm .cmd shim with node, without cmd.exe', () => {
    expect(shimTarget('C:\\npm\\codex.cmd', env, fs)).toEqual(['C:\\node\\node.exe', 'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'])
    const l = resolveLaunch(['codex', 'exec', NASTY], env, 'win32', fs)
    expect(l.file).toBe('C:\\node\\node.exe')
    expect(parseWindowsArgs(l.args as string)).toEqual(['C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js', 'exec', NASTY])
  })

  it('falls back to cmd.exe for other .cmd scripts, and refuses a multi-line prompt there', () => {
    const l = resolveLaunch(['weird', 'one line'], env, 'win32', fs)
    expect(l.file).toBe('C:\\Windows\\system32\\cmd.exe')
    expect(l.args).toMatch(/^\/d \/s \/c "C:\\tools\\weird\.cmd /)
    expect(() => resolveLaunch(['weird', 'two\nlines'], env, 'win32', fs)).toThrow(/line breaks/)
  })

  it("runs the newest version's node behind a versioned launcher (Cursor's agent.cmd)", () => {
    const v = 'C:\\cursor\\versions\\2026.10.22-27dcf5f'
    expect(versionedTarget('C:\\cursor\\agent.cmd', fs)).toEqual([`${v}\\node.exe`, `${v}\\index.js`])
    const l = resolveLaunch(['agent', '-p', NASTY], env, 'win32', fs)
    expect(l.file).toBe(`${v}\\node.exe`)
    expect(parseWindowsArgs(l.args as string)).toEqual([`${v}\\index.js`, '-p', NASTY])
  })

  it('takes a multi-line prompt through the PowerShell script next to a .cmd', () => {
    const l = resolveLaunch(['pwshy', 'two\nlines'], env, 'win32', fs)
    expect(l.file).toBe(ps)
    expect(parseWindowsArgs(l.args as string)).toEqual(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\tools\\pwshy.ps1', 'two\nlines'])
  })

  it('runs a typed .ps1 command with PowerShell instead of opening it in Notepad', () => {
    expect(windowsShellLaunch('.\\deploy.ps1 -Env prod', env, undefined, fs)).toEqual({ file: ps, args: '-NoProfile -ExecutionPolicy Bypass -File .\\deploy.ps1 -Env prod' })
    expect(windowsShellLaunch('& "C:\\my scripts\\build.ps1"', env, 'pwsh.exe', fs)).toEqual({ file: 'pwsh.exe', args: '-NoProfile -ExecutionPolicy Bypass -File "C:\\my scripts\\build.ps1"' })
    expect(windowsShellLaunch('npm ci && npm test', env, undefined, fs)).toEqual({ file: 'C:\\Windows\\system32\\cmd.exe', args: '/d /s /c "npm ci && npm test"' })
  })

  it('says when a program is missing', () => {
    expect(() => resolveLaunch(['gemini', 'hi'], env, 'win32', fs)).toThrow(/gemini was not found on PATH/)
  })
})

describe('resolveLaunch on POSIX', () => {
  it.skipIf(process.platform === 'win32')('spawns the program directly: a stand-in receives the exact prompt as one argument', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sldev-argv-'))
    const out = join(dir, 'argv.json')
    const agent = join(dir, 'fake-agent')
    writeFileSync(agent, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)))\n`)
    chmodSync(agent, 0o755)
    const l = resolveLaunch(['fake-agent', '-n', 'Fix bug', NASTY], { PATH: `${dir}:/usr/bin` })
    expect(l.file).toBe(agent)
    const r = spawnSync(l.file, l.args as string[])
    expect(r.status).toBe(0)
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual(['-n', 'Fix bug', NASTY])
  })
})
