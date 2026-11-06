import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { dataDir, socketPath } from '../src/paths'
import { notifyCommand } from '../src/notify'
import { checkLaunch } from '../src/loops'
import { pickEditor } from '../src/editor'
import { ago, ghProblem, runColumns } from '../src/workflows'
import { ghRunSignal } from '@shared/status'
import { lineReader } from '../src/protocol'
import { drawTerm, fit, layout } from '../src/render'
import { createTerm, screenText } from '../src/screen'
import { periodStart, usageTable } from '../src/usage'
import { VERSION } from '../src/version'

const write = (t: ReturnType<typeof createTerm>, s: string): Promise<void> => new Promise((r) => t.write(s, r))

describe('cli units', () => {
  it('VERSION matches cli/package.json', () => {
    expect(VERSION).toBe(JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version)
  })

  it('shares the app data folder per platform, with an override', () => {
    expect(dataDir({ SLDEV_DATA_DIR: '/x' }, 'linux')).toBe('/x')
    expect(dataDir({ XDG_CONFIG_HOME: '/cfg' }, 'linux')).toBe('/cfg/sldev-io')
    expect(dataDir({}, 'darwin')).toMatch(/Library\/Application Support\/sldev-io$/)
    expect(dataDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32')).toContain('sldev-io')
  })

  it('keeps the socket path under the Unix limit', () => {
    expect(socketPath('/home/a/.config/sldev-io/cli', 'linux')).toBe('/home/a/.config/sldev-io/cli/daemon.sock')
    const long = socketPath(`/${'x'.repeat(120)}/cli`, 'linux')
    expect(long.length).toBeLessThan(100)
    expect(long).toMatch(/sldev-[0-9a-f]{16}\.sock$/)
    expect(socketPath('C:\\data\\cli', 'win32')).toMatch(/^\\\\\.\\pipe\\sldev-/)
  })

  it('notifies from argv, never a shell string', () => {
    const mac = notifyCommand('Fix "it"', "it's done; rm -rf /", 'darwin', {})!.argv
    expect(mac[0]).toBe('osascript')
    expect(mac.slice(-2)).toEqual(['Fix "it"', "it's done; rm -rf /"])
    expect(notifyCommand('a', 'b', 'darwin', { SLDEV_NOTIFY: '0' })).toBeNull()
    // Windows: a toast whose texts come through the environment, never into the PowerShell script
    const win = notifyCommand('Fix "it"', "'; Remove-Item C:\\ -Recurse; '", 'win32', {})!
    expect(win.argv[0]).toBe('powershell.exe')
    expect(win.argv.join(' ')).not.toContain('Remove-Item')
    expect(win.env).toEqual({ SLDEV_NOTE_TITLE: 'Fix "it"', SLDEV_NOTE_BODY: "'; Remove-Item C:\\ -Recurse; '" })
    expect(notifyCommand('a', 'b', 'win32', { SLDEV_NOTIFY: '0' })).toBeNull()
  })

  it('runs a repeat check through the shell, and a .ps1 one through PowerShell on Windows', () => {
    expect(checkLaunch('npm test', 'linux')).toEqual({ file: 'npm test', args: [], shell: true })
    expect(checkLaunch('npm test', 'win32').shell).toBe(true)
    for (const c of ['scripts\\check.ps1', '.\\check.ps1 -Fast', '"C:\\My Scripts\\check.ps1"', '& .\\check.ps1']) {
      const l = checkLaunch(c, 'win32')
      expect(l.file).toBe('powershell.exe')
      expect(l.args.at(-1)).toBe(c)
    }
    expect(checkLaunch('check.ps1', 'linux').shell).toBe(true)
  })

  it('says what to do when gh is missing, signed out, or the folder has no GitHub remote', () => {
    expect(ghProblem('spawn gh ENOENT')).toMatch(/isn't installed: https:\/\/cli.github.com/)
    expect(ghProblem("'gh' is not recognized as an internal or external command")).toMatch(/isn't installed/)
    expect(ghProblem('To get started with GitHub CLI, please run:  gh auth login')).toBe('Not signed in to GitHub: run gh auth login')
    expect(ghProblem('no git remotes found')).toMatch(/isn't a GitHub repository/)
    expect(ghProblem('HTTP 502: bad gateway\nmore')).toBe('HTTP 502: bad gateway')
  })

  it('shows a workflow run with its status, branch, title and age', () => {
    const run = { databaseId: 9, number: 3, displayTitle: 'Fix it', workflowName: 'CI', status: 'completed', conclusion: 'failure', headBranch: 'main', event: 'push', createdAt: new Date(10_000).toISOString(), url: '' }
    expect(runColumns(run, 10_000 + 5 * 60_000)).toEqual({ label: 'Failed', tone: 'error', text: 'CI · main · Fix it · 5m ago' })
    expect(ghRunSignal({ status: 'in_progress', conclusion: '' })).toMatchObject({ tone: 'working', pulse: true })
    expect(ghRunSignal({ status: 'queued', conclusion: '' }).label).toBe('Queued')
    expect(ghRunSignal({ status: 'completed', conclusion: 'success' }).tone).toBe('done')
    expect(ghRunSignal({ status: 'completed', conclusion: 'cancelled' }).tone).toBe('neutral')
    expect(ago(new Date(0).toISOString(), 3 * 86_400_000)).toBe('3d')
  })

  it('picks the editor asked for, else the app’s preferred one, else the first GUI editor', () => {
    const found = [
      { id: 'nvim', name: 'Neovim', kind: 'terminal' as const },
      { id: 'cursor', name: 'Cursor', kind: 'gui' as const, canDiff: true },
      { id: 'zed', name: 'Zed', kind: 'gui' as const }
    ]
    expect(pickEditor(found)?.id).toBe('cursor')
    expect(pickEditor(found, null, 'zed')?.id).toBe('zed')
    // a preferred editor that isn't installed here is passed over
    expect(pickEditor(found, null, 'vscode')?.id).toBe('cursor')
    expect(pickEditor(found, 'Neovim')?.id).toBe('nvim')
    expect(pickEditor(found, 'sublime')).toBeUndefined()
    expect(pickEditor([found[0]])?.id).toBe('nvim')
  })

  it('reads JSON lines across chunks and drops junk', () => {
    const got: unknown[] = []
    const feed = lineReader((m) => got.push(m))
    feed('{"a":1}\n{"b"')
    feed(':2}\nnot json\n\n')
    expect(got).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('lays out a sidebar and one or two panes', () => {
    const one = layout(120, 40, false)
    expect(one.sidebar).not.toBeNull()
    expect(one.panes).toHaveLength(1)
    expect(one.panes[0].x + one.panes[0].w).toBe(120)
    const two = layout(120, 40, true)
    expect(two.panes).toHaveLength(2)
    expect(two.panes[1].x + two.panes[1].w).toBe(120)
    expect(layout(60, 20, true).sidebar).toBeNull()
    expect(fit('héllo', 3)).toBe('hél')
    expect(fit('ab', 4)).toBe('ab  ')
    expect(fit('日本', 3)).toBe('日 ')
  })

  it('draws a screen back with its colours, and reads text without the empty rows', async () => {
    const t = createTerm(20, 5)
    await write(t, 'plain\r\n\x1b[31mred\x1b[0m\r\n')
    const out = drawTerm(t, { x: 0, y: 0, w: 10, h: 3 })
    expect(out).toContain('\x1b[0;31;49mred')
    expect(out).toContain('plain')
    expect(screenText(t, 1)).toBe('red')
    expect(screenText(t, 10)).toBe('plain\nred')
  })

  it('starts the usage period at midnight or on Monday', () => {
    const wed = new Date(2026, 10, 4, 15, 30)
    expect(new Date(periodStart(false, wed))).toEqual(new Date(2026, 10, 4))
    expect(new Date(periodStart(true, wed))).toEqual(new Date(2026, 10, 2))
    const sun = new Date(2026, 10, 8, 9)
    expect(new Date(periodStart(true, sun))).toEqual(new Date(2026, 10, 2))
  })

  it('prints usage as a table with the cost caveat', () => {
    const t = usageTable([{ agent: 'Claude Code', sessions: 2, usage: { input: 1200, output: 3_400_000, cacheRead: 0, cacheWrite: 0, cost: 1.5, unpriced: 0 } }], 'today')
    expect(t).toContain('Claude Code')
    expect(t).toContain('3.4M')
    expect(t).toContain('$1.50')
    expect(t).toContain('estimate')
  })
})
