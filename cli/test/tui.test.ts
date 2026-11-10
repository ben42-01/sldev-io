import { mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough, Writable } from 'stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, type Client } from '../src/client'
import { startDaemon, type Daemon } from '../src/daemon'
import { removeTemp, useFakeAgents } from './fakePath'
import type { TuiServices } from '../src/tui'
import { createTerm, screenText } from '../src/screen'
import { runTui, win32Key } from '../src/tui'
import { layout, paneSignal, SIDEBAR_MIN_COLS, SIDEBAR_W, tabBar, tabWindow, TONE_SGR } from '../src/render'

/** The TUI against a real daemon and the fake codex; its output is read back through a headless screen. */

const tmp = mkdtempSync(join(tmpdir(), 'sldev-tui-'))
const data = join(tmp, 'data')
const work = join(tmp, 'work')
let daemon: Daemon
let c: Client
let restorePath: () => void

beforeAll(async () => {
  restorePath = useFakeAgents()
  mkdirSync(work, { recursive: true })
  daemon = await startDaemon({ dataDir: data, notify: () => undefined })
  c = await connect({ dataDir: data, script: '', start: false })
})

afterAll(async () => {
  c?.close()
  await daemon?.close()
  restorePath()
  // Windows keeps a just-killed process's folder locked for a moment (EBUSY): retry instead of failing
  removeTemp(tmp)
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('sldev TUI', () => {
  it('shows the panes with their status, splits, starts a pane from the prompt, and detaches', async () => {
    await c.request('new', { agent: 'codex', brief: 'tidy up the tests', cwd: work })
    const screen = createTerm(110, 30)
    let written = Promise.resolve()
    const output = Object.assign(
      new Writable({
        write(chunk, _enc, done) {
          written = new Promise((r) => screen.write(chunk.toString(), r))
          done()
        }
      }),
      { columns: 110, rows: 30 }
    )
    const input = new PassThrough()
    // GitHub and the editor are fakes: the test never asks GitHub or opens a window
    const calls: string[] = []
    const services: TuiServices = {
      runs: async () => [
        { databaseId: 101, number: 7, displayTitle: 'Polish the sidebar', workflowName: 'CI', status: 'completed', conclusion: 'failure', headBranch: 'main', event: 'push', createdAt: new Date().toISOString(), url: '' },
        { databaseId: 100, number: 6, displayTitle: 'Add dark mode', workflowName: 'CI', status: 'completed', conclusion: 'success', headBranch: 'main', event: 'push', createdAt: new Date().toISOString(), url: '' }
      ],
      rerun: async (_cwd, id) => void calls.push(`rerun ${id}`),
      openRun: async (_cwd, id) => void calls.push(`open run ${id}`),
      open: async (p, diff) => (calls.push(`editor ${p.id} ${diff ? 'diff' : 'folder'}`), { note: `Opened ${p.cwd} in Cursor` })
    }
    const tui = runTui(await connect({ dataDir: data, script: '', start: false }), work, { input, output }, services)
    const text = async (): Promise<string> => {
      await sleep(300)
      await written
      return screenText(screen, 30)
    }

    // the fake codex needs a moment to start and print, longer when the whole suite runs at once
    const textWith = async (want: string | RegExp, timeout = 10_000): Promise<string> => {
      const end = Date.now() + timeout
      const has = (t: string): boolean => (typeof want === 'string' ? t.includes(want) : want.test(t))
      let t = await text()
      while (!has(t) && Date.now() < end) t = await text()
      return t
    }

    let s = await textWith(/thinking \d/)
    expect(s).toContain('sldev')
    expect(s).toContain('1 tidy up the tests')
    expect(s).toMatch(/Codex · (Working|Starting|Ready for you)/)
    // the pane's screen: the fake codex echoes its argv, then thinks (on a slow run the first lines have scrolled by)
    expect(s).toMatch(/thinking \d/)
    expect(s).toContain('Ctrl-b then')

    // Ctrl-b w: the workflows, newest first; r asks before it reruns the failed jobs
    input.write('\x02w')
    s = await textWith('Polish the sidebar')
    expect(s).toContain('Workflows ·')
    expect(s).toMatch(/Failed +CI · main · Polish the sidebar/)
    expect(s).toMatch(/Passed +CI · main · Add dark mode/)
    expect(s).toContain('Enter open in browser')
    input.write('r')
    expect(await textWith('Rerun the failed jobs of CI #7? (y/N)')).toContain('(y/N)')
    input.write('y\r')
    await textWith('Rerunning the failed jobs of #7')
    input.write('\x1b[B')
    input.write('\r')
    await textWith('Opened run 100 in the browser')
    expect(calls).toEqual(['rerun 101', 'open run 100'])
    input.write('\x1b')
    s = await textWith('Ctrl-b then')
    expect(s).not.toContain('Workflows ·')

    // Ctrl-b e and v: the focused pane in the editor, its folder or its changed files
    input.write('\x02e')
    await textWith('in Cursor')
    input.write('\x02v')
    await sleep(300)
    expect(calls.slice(2)).toEqual(['editor 1 folder', 'editor 1 diff'])

    input.write('\x02c')
    expect(await textWith('New pane (agent, then the brief):')).toContain('New pane (agent, then the brief):')
    input.write('codex second job')
    input.write('\r')
    s = await textWith('2 second job')
    expect(s).toContain('2 second job')

    input.write('\x02s')
    s = await textWith('│● #2 second job')
    // both pane headers side by side on one row
    expect(s).toMatch(/● 1 tidy up the tests .*● 2 second job/)

    // typing goes to the pane in focus
    input.write('\x022')
    await sleep(100)
    input.write('x')
    await sleep(200)
    expect((await c.request('ls', {})).length).toBe(2)

    input.write('\x02d')
    await tui
    expect(await textWith('Detached.')).toContain('Detached. The agents keep running')
    // detaching leaves the agents running
    expect((await c.request('ls', {})).map((p) => p.status)).not.toContain('ended')
  }, 30_000)
})

/** A TUI on its own fake terminal, against the test daemon. */
async function attachTui(cols: number, rows: number) {
  const screen = createTerm(cols, rows)
  let written = Promise.resolve()
  const output = Object.assign(
    new Writable({
      write(chunk, _enc, done) {
        written = new Promise((r) => screen.write(chunk.toString(), r))
        done()
      }
    }),
    { columns: cols, rows }
  )
  const input = new PassThrough()
  const services: TuiServices = { runs: async () => [], rerun: async () => undefined, openRun: async () => undefined, open: async () => ({ note: '' }) }
  const tui = runTui(await connect({ dataDir: data, script: '', start: false }), work, { input, output }, services)
  const text = async (): Promise<string> => {
    await sleep(200)
    await written
    return screenText(screen, rows)
  }
  const textWith = async (want: string | RegExp, timeout = 10_000): Promise<string> => {
    const end = Date.now() + timeout
    const has = (t: string): boolean => (typeof want === 'string' ? t.includes(want) : want.test(t))
    let t = await text()
    while (!has(t) && Date.now() < end) t = await text()
    if (!has(t)) throw new Error(`screen never showed ${want}:\n${t}`)
    return t
  }
  /** the first row: the tab bar */
  const bar = (): string => screen.buffer.active.getLine(screen.buffer.active.viewportY)?.translateToString(true) ?? ''
  return { input, tui, textWith, bar }
}

describe('sldev TUI tabs', () => {
  // a plain sh: the test doesn't depend on the user's shell profile
  let savedShell: string | undefined
  beforeAll(() => {
    savedShell = process.env.SHELL
    if (process.platform !== 'win32') process.env.SHELL = '/bin/sh'
  })
  afterAll(() => {
    if (savedShell === undefined) delete process.env.SHELL
    else process.env.SHELL = savedShell
  })

  it('opens a shell tab, renames it, switches tabs, closes one, and restores them all on re-attach', async () => {
    // the first test left two codex panes, split, with pane 2 in front
    let t = await attachTui(100, 30)
    let s = await t.textWith('● 2 second job')
    expect(t.bar()).toMatch(/● 1 tidy up the tests\s+● 2 second job/)
    // the split came back: two pane headers on the second row
    expect(s).toMatch(/● #2 second job · Codex .*│● #1 tidy up the tests · Codex/)
    t.input.write('\x02s')
    s = await t.textWith(/^● #2 second job · Codex[^│]*$/m)

    // Ctrl-b t: a plain shell, in front, in the folder of the tab that was in focus
    const before = (await c.request('ls', {})).map((p) => p.id)
    t.input.write('\x02t')
    s = await t.textWith(/● 3 \S+/)
    const shellId = (await c.request('ls', {})).find((p) => !before.includes(p.id))!.id
    expect(t.bar()).toMatch(new RegExp(`● 3 \\S+`))
    expect(s).toMatch(new RegExp(`● #${shellId} \\S+ · \\S+ · ${work.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`))
    // the sum shows only in the output, not in the echoed command (PowerShell on Windows)
    t.input.write(process.platform === 'win32' ? 'echo ("tab-" + (20+3))\r' : 'echo tab-$((20+3))\r')
    await t.textWith('tab-23')
    const shell = (await c.request('ls', {})).find((p) => p.id === shellId)!
    expect(shell).toMatchObject({ shell: true, cwd: work })

    // Ctrl-b , renames it (the prompt starts with the current name)
    t.input.write('\x02,')
    await t.textWith(`Rename tab ${shellId}: ${shell.title}`)
    t.input.write('\x7f'.repeat(shell.title.length) + 'logs\r')
    await t.textWith('3 logs')
    expect((await c.request('ls', {})).find((p) => p.id === shellId)?.title).toBe('logs')

    // n/p and 1-9 move the focus; a key past the last tab does nothing
    t.input.write('\x021')
    await t.textWith(/^● #1 tidy up the tests · Codex/m)
    t.input.write('\x02n')
    await t.textWith(/^● #2 second job · Codex/m)
    t.input.write('\x02p\x02p')
    await t.textWith(/^● #\d+ logs · /m)
    t.input.write('\x029')
    await t.textWith(/^● #\d+ logs · /m)
    // Ctrl-b < moves the shell tab one place left
    t.input.write('\x02<')
    await t.textWith(/● 2 logs\s+● 3 second job/)
    t.input.write('\x02d')
    await t.tui

    // attaching again: the same tabs, order, names, and the shell in front
    expect((await c.request('tabs', {})).active).toBe(shellId)
    t = await attachTui(100, 30)
    s = await t.textWith('● 2 logs')
    expect(t.bar()).toMatch(/● 1 tidy up the tests\s+● 2 logs\s+● 3 second job/)
    expect(s).toMatch(/^● #\d+ logs · /m)
    // the shell kept its screen while detached
    expect(s).toContain('tab-23')

    // Ctrl-b x asks before it closes a tab with a live shell
    t.input.write('\x02x')
    await t.textWith(`Close tab ${shellId}? Its shell`)
    t.input.write('y\r')
    // the tab that took its place comes to the front
    await t.textWith(/^● #2 second job · Codex/m)
    expect(t.bar()).toMatch(/● 1 tidy up the tests\s+● 2 second job/)
    expect(t.bar()).not.toContain('logs')
    expect((await c.request('ls', {})).some((p) => p.id === shellId)).toBe(false)
    t.input.write('\x02d')
    await t.tui
  }, 40_000)
})

/** one key as Windows Terminal's win32-input-mode sends it */
const w32 = (vk: number, ch: string, down: boolean, ctrl = false): string => `\x1b[${vk};0;${ch ? ch.charCodeAt(0) : 0};${down ? 1 : 0};${ctrl ? 8 : 0};1_`
/** a key pressed and released, Ctrl held around it when asked */
const press = (vk: number, ch: string, ctrl = false): string =>
  (ctrl ? w32(17, '', true, true) : '') + w32(vk, ch, true, ctrl) + w32(vk, ch, false, ctrl) + (ctrl ? w32(17, '', false) : '')

describe('keys in win32-input-mode (Windows Terminal)', () => {
  it('decodes a key press to its bytes, and a release or a lone modifier to nothing', () => {
    expect(win32Key(w32(66, '\x02', true, true))).toEqual({ len: w32(66, '\x02', true, true).length, text: '\x02' })
    expect(win32Key(w32(78, 'n', false))?.text).toBe('')
    expect(win32Key(w32(17, '', true, true))?.text).toBe('')
    expect(win32Key(w32(38, '', true))?.text).toBe('\x1b[A')
    expect(win32Key('\x1b[A')).toBeNull()
  })

  it('takes Ctrl-b and the keys after it from encoded input, and passes the rest to the tab', async () => {
    // the tabs test left the two codex panes, the second in front
    const t = await attachTui(100, 30)
    await t.textWith(/^● #2 second job · Codex/m)
    // what the terminal sends for Ctrl-b, then n: modifier and release events included
    t.input.write(press(66, '\x02', true) + press(78, 'n'))
    await t.textWith(/^● #1 tidy up the tests · Codex/m)
    t.input.write(press(66, '\x02', true))
    await sleep(50)
    t.input.write(press(80, 'p'))
    await t.textWith(/^● #2 second job · Codex/m)
    // a prompt reads encoded keys too
    t.input.write(press(66, '\x02', true) + press(188, ','))
    await t.textWith('Rename tab 2: second job')
    t.input.write(press(8, '') + press(8, '') + press(8, '') + press(83, 'S') + press(13, '\r'))
    await t.textWith('2 second S')
    t.input.write('\x02d')
    await t.tui
  }, 30_000)
})

const plain = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

describe('tab layout', () => {
  it('puts the tab bar on the first row of the main area, the panes under it', () => {
    const wide = layout(140, 40, false)
    expect(wide.sidebar).toEqual({ x: 0, y: 0, w: SIDEBAR_W, h: 39 })
    expect(wide.tabs).toEqual({ x: SIDEBAR_W + 1, y: 0, w: 140 - SIDEBAR_W - 1, h: 1 })
    expect(wide.panes).toEqual([{ x: SIDEBAR_W + 1, y: 1, w: 140 - SIDEBAR_W - 1, h: 38 }])
    expect(wide.status).toEqual({ x: 0, y: 39, w: 140, h: 1 })
    const split = layout(140, 40, true)
    expect(split.panes).toHaveLength(2)
    expect(split.panes[0].w + 1 + split.panes[1].w).toBe(split.tabs.w)
  })

  it('drops the sidebar below its width, and the split when two panes would not fit', () => {
    expect(layout(SIDEBAR_MIN_COLS - 1, 30, false).sidebar).toBeNull()
    expect(layout(SIDEBAR_MIN_COLS - 1, 30, true).panes).toHaveLength(2)
    const narrow = layout(50, 10, true)
    expect(narrow.sidebar).toBeNull()
    expect(narrow.panes).toEqual([{ x: 0, y: 1, w: 50, h: 8 }])
    // a terminal too small for anything still gets rects that don't overlap the status row
    const tiny = layout(5, 1, false)
    expect(tiny.panes[0].y + tiny.panes[0].h).toBeLessThanOrEqual(tiny.status.y)
  })

  it('keeps the active tab in view when the tabs overflow', () => {
    expect(tabWindow([10, 10, 10], 0, 40)).toEqual({ start: 0, end: 3 })
    expect(tabWindow([10, 10, 10, 10, 10], 0, 25)).toEqual({ start: 0, end: 2 })
    expect(tabWindow([10, 10, 10, 10, 10], 4, 25)).toEqual({ start: 3, end: 5 })
    expect(tabWindow([10, 10, 10, 10, 10], 2, 25)).toEqual({ start: 2, end: 4 })
  })

  it('draws a bar of exactly the width, each tab with its marker in its tone, the active one inverted', () => {
    const tabs = [
      { title: 'fix the parser', tone: 'working' as const, active: false },
      { title: 'bash', tone: 'neutral' as const, active: true },
      { title: 'review it', tone: 'attention' as const, active: false }
    ]
    const bar = tabBar(tabs, 80)
    expect(plain(bar)).toBe(' ● 1 fix the parser  ● 2 bash  ● 3 review it '.padEnd(80))
    expect(bar).toContain(`\x1b[${TONE_SGR.attention}m\x1b[1m●`)
    expect(bar).toContain(`\x1b[${TONE_SGR.working}m●`)
    // only the active tab is inverted
    expect(bar.split('\x1b[1;7m').length - 1).toBeGreaterThan(0)
    expect(bar.indexOf('\x1b[1;7m')).toBeGreaterThan(bar.indexOf(' 1 fix the parser'))
    expect(bar.indexOf('\x1b[1;7m')).toBeLessThan(bar.indexOf(' 2 bash'))
    expect(bar.lastIndexOf('\x1b[1;7m')).toBeLessThan(bar.indexOf(' 3 review it'))
    // too many to fit: the active tab stays, arrows say there are more, and the width holds
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `session number ${i + 1}`, tone: 'done' as const, active: i === 9 }))
    const scrolled = plain(tabBar(many, 60))
    expect(scrolled).toHaveLength(60)
    expect(scrolled).toContain('10 session numbe')
    expect(scrolled.startsWith('‹')).toBe(true)
    expect(scrolled.endsWith('›')).toBe(true)
    // very narrow: one tab, cut
    expect(plain(tabBar(many, 12))).toHaveLength(12)
  })

  it('marks a shell tab neutral, and an agent by its mission status', () => {
    expect(paneSignal({ status: 'waiting', shell: true, pid: 3 })).toEqual({ tone: 'neutral', label: 'Shell' })
    expect(paneSignal({ status: 'needs-input' }).tone).toBe('attention')
    expect(paneSignal({ status: 'working' }).tone).toBe('working')
  })
})
