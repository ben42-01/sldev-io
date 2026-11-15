import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough, Writable } from 'stream'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connect, type Client } from '../src/client'
import { startDaemon, type Daemon } from '../src/daemon'
import { removeTemp, useFakeAgents } from './fakePath'
import type { TuiServices } from '../src/tui'
import { createTerm, screenText } from '../src/screen'
import { runTui, win32Key } from '../src/tui'
import { brandAt, drawTerm, ellipsis, glyph, inSelection, isLightBackground, to256, layout, selectionText, paneSignal, paneTree, popup, rollup, ruleLine, SIDEBAR_MIN_COLS, SIDEBAR_W, sidebar, tabBar, tabBarLayout, tabWindow, tailFit, TONE_SGR } from '../src/render'
import type { PaneInfo } from '../src/protocol'
import * as R from '../src/render'

const esc = (s: string): string => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
/** the sidebar row of the tab in focus: the accent bar, its marker, number and title */
const focused = (title: string): RegExp => new RegExp(`▌ \\S \\d+ ${esc(title)}`)
/** a tab on the bar or a row in the sidebar: any marker (a spinner while it works), its number and title */
const tab = (n: number, title: string): RegExp => new RegExp(`\\S ${n} ${esc(title)}`)

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
    expect(s).toMatch(tab(1, 'tidy up the tests'))
    // the sidebar groups it under its project, the rule says who runs it
    expect(s).toMatch(/Codex · (working|starting|ready for you)/)
    expect(s).toMatch(/#1 · Codex · /)
    // the pane's screen: the fake codex echoes its argv, then thinks (on a slow run the first lines have scrolled by)
    expect(s).toMatch(/thinking \d/)
    expect(s).toContain('^b c new tab')

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
    s = await textWith('^b c new tab')
    expect(s).not.toContain('Workflows ·')

    // Ctrl-b e and v: the focused pane in the editor, its folder or its changed files
    input.write('\x02e')
    await textWith('in Cursor')
    input.write('\x02v')
    await sleep(300)
    expect(calls.slice(2)).toEqual(['editor 1 folder', 'editor 1 diff'])

    // Ctrl-b c: the New tab popup, a shell and every agent; a number starts that agent after asking for a brief
    input.write('\x02c')
    s = await textWith('New tab')
    expect(s).toMatch(/t +Shell/)
    expect(s).toMatch(/2 +Codex/)
    input.write('2')
    await textWith('Codex, brief')
    input.write('second job')
    input.write('\r')
    s = await textWith(tab(2, 'second job'))
    expect(s).toMatch(focused('second job'))

    input.write('\x02s')
    // both panes side by side, each named on the rule above it
    s = await textWith(/2 second job · Codex.*┬.*1 tidy up the tests · Codex/)

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
async function attachTui(cols: number, rows: number, extra: Partial<TuiServices> = {}) {
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
  // the clipboard is a fake too: the tests never touch the real one
  const copied: string[] = []
  const services: TuiServices = { runs: async () => [], rerun: async () => undefined, openRun: async () => undefined, open: async () => ({ note: '' }), copy: async (t) => (copied.push(t), true), ...extra }
  let sent = ''
  const tui = runTui(await connect({ dataDir: data, script: '', start: false }), work, { input, output: Object.assign(output, { write: ((orig) => (chunk: string, ...rest: never[]) => ((sent += chunk), orig(chunk, ...rest)))(output.write.bind(output)) }) }, services, data)
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
  return { input, tui, textWith, bar, copied, sent: () => sent }
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
    let s = await t.textWith(tab(2, 'second job'))
    expect(t.bar()).toMatch(/1 tidy up the tests\s+\S 2 second job/)
    // the split came back: two panes named on the rule row
    expect(s).toMatch(/2 second job · Cod.*┬.*1 tidy up the tests/)
    t.input.write('\x02s')
    s = await t.textWith(/#2 · Codex · /)

    // Ctrl-b t: a plain shell, in front, in the folder of the tab that was in focus
    const before = (await c.request('ls', {})).map((p) => p.id)
    t.input.write('\x02t')
    s = await t.textWith(/› 3 \S+/)
    const shellId = (await c.request('ls', {})).find((p) => !before.includes(p.id))!.id
    expect(t.bar()).toMatch(/› 3 \S+/)
    // the rule says where it runs (cut from the left on a long path, so the folder name stays)
    expect(s).toContain(`#${shellId} · ${tailFit(work, 40).trimEnd()}`)
    // the sum shows only in the output, not in the echoed command (PowerShell on Windows)
    t.input.write(process.platform === 'win32' ? 'echo ("tab-" + (20+3))\r' : 'echo tab-$((20+3))\r')
    await t.textWith('tab-23')
    const shell = (await c.request('ls', {})).find((p) => p.id === shellId)!
    expect(shell).toMatchObject({ shell: true, cwd: work })

    // Ctrl-b , renames it (the prompt starts with the current name)
    t.input.write('\x02,')
    await t.textWith(`Rename tab ${shellId}: ${shell.title}`)
    t.input.write('\x7f'.repeat(shell.title.length) + 'logs\r')
    await t.textWith(tab(3, 'logs'))
    expect((await c.request('ls', {})).find((p) => p.id === shellId)?.title).toBe('logs')

    // n/p and 1-9 move the focus; a key past the last tab does nothing
    t.input.write('\x021')
    await t.textWith(focused('tidy up the tests'))
    t.input.write('\x02n')
    await t.textWith(focused('second job'))
    t.input.write('\x02p\x02p')
    await t.textWith(focused('logs'))
    t.input.write('\x029')
    await t.textWith(focused('logs'))
    // Ctrl-b < moves the shell tab one place left
    t.input.write('\x02<')
    await t.textWith(/› 2 logs\s+\S 3 second job/)
    t.input.write('\x02d')
    await t.tui

    // attaching again: the same tabs, order, names, and the shell in front
    expect((await c.request('tabs', {})).active).toBe(shellId)
    t = await attachTui(100, 30)
    s = await t.textWith('› 2 logs')
    expect(t.bar()).toMatch(/\S 1 tidy up the tests\s+› 2 logs\s+\S 3 second job/)
    expect(s).toMatch(focused('logs'))
    // the shell kept its screen while detached
    expect(s).toContain('tab-23')

    // Ctrl-b x asks before it closes a tab with a live shell
    t.input.write('\x02x')
    await t.textWith(`Close tab ${shellId}? Its shell`)
    t.input.write('y\r')
    // the tab that took its place comes to the front
    await t.textWith(focused('second job'))
    expect(t.bar()).toMatch(/\S 1 tidy up the tests\s+\S 2 second job/)
    expect(t.bar()).not.toContain('logs')
    expect((await c.request('ls', {})).some((p) => p.id === shellId)).toBe(false)
    t.input.write('\x02d')
    await t.tui
  }, 40_000)
})

describe('closing a tab whose agent started others', () => {
  it('asks a second question, and closes the children’s tabs too only on yes', async () => {
    const repo = join(tmp, 'kids')
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src/app.js'), '1\n')
    for (const a of [['init', '-q', '-b', 'main'], ['add', '-A'], ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'i']]) execFileSync('git', a, { cwd: repo })
    const run = async (answer: string): Promise<{ lead: string; kid: string; left: string[] }> => {
      const lead = await c.request('new', { agent: 'codex', brief: `lead ${answer}`, cwd: repo, worktree: false, allowSpawn: 1 })
      const inside = await connect({ dataDir: data, script: '', start: false })
      inside.from = { pane: lead.id, daemon: daemon.instance }
      const kid = await inside.request('new', { agent: 'codex', brief: `kid ${answer}`, cwd: repo })
      inside.close()
      await c.request('tabs', { active: lead.id })
      const t = await attachTui(110, 30)
      await t.textWith(`lead ${answer}`)
      // the child sits under its parent in the sidebar
      await t.textWith(new RegExp(`└\\S \\d+ kid ${answer}`))
      t.input.write('\x02x')
      await t.textWith(`Close tab ${lead.id}? Its agent stops`)
      t.input.write('y\r')
      await t.textWith(`Also close the tab of agents it started (${kid.id})?`)
      t.input.write(`${answer}\r`)
      await sleep(300)
      t.input.write('\x02d')
      await t.tui
      return { lead: lead.id, kid: kid.id, left: (await c.request('ls', {})).map((p) => p.id) }
    }
    const no = await run('n')
    expect(no.left).not.toContain(no.lead)
    expect(no.left).toContain(no.kid)
    await c.request('kill', { pane: no.kid })
    const yes = await run('y')
    expect(yes.left).not.toContain(yes.lead)
    expect(yes.left).not.toContain(yes.kid)
  }, 30_000)
})

describe('selecting and scrolling in a tab', () => {
  it('copies what is dragged over in a shell tab, scrolls its history with the wheel, and types back to the bottom', async () => {
    const savedShell = process.env.SHELL
    if (process.platform !== 'win32') process.env.SHELL = '/bin/sh'
    const t = await attachTui(110, 20)
    t.input.write('\x02t')
    await t.textWith(/› \d+ \S+/)
    if (process.platform !== 'win32') process.env.SHELL = savedShell
    t.input.write(process.platform === 'win32' ? '1..40 | % { "row-$_" }\r' : 'i=1; while [ $i -le 40 ]; do echo row-$i; i=$((i+1)); done\r')
    let s = await t.textWith('row-40')
    // the pane starts right of the sidebar (29 columns) and under the rule (row 2); a drag from the first
    // visible row-N to the end of the next copies those two lines
    const rows = s.split('\n')
    const first = rows.findIndex((r) => /│row-\d+/.test(r))
    const n = Number(/│row-(\d+)/.exec(rows[first])![1])
    t.input.write(`\x1b[<0;30;${first + 1}M\x1b[<32;34;${first + 2}M\x1b[<0;36;${first + 2}m`)
    await t.textWith('Copied')
    expect(t.copied).toEqual([`row-${n}\nrow-${n + 1}`])
    // and through OSC 52, for terminals that take it
    expect(t.sent()).toContain(`\x1b]52;c;${Buffer.from(`row-${n}\nrow-${n + 1}`).toString('base64')}\x07`)

    // the wheel goes back through the history, and says how far
    t.input.write('\x1b[<64;60;8M\x1b[<64;60;8M')
    s = await t.textWith('↑ 6 lines back')
    expect(s).toContain(`│row-${n - 6}`)
    // typing goes back to the newest output
    t.input.write(' ')
    s = await t.textWith(/^(?![\s\S]*lines back)/)
    expect(s).toContain('row-40')
    t.input.write('\x7f\x02x')
    await t.textWith('(y/N)')
    t.input.write('y\r\x02d')
    await t.tui
  }, 30_000)
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
    await t.textWith(focused('second job'))
    // what the terminal sends for Ctrl-b, then n: modifier and release events included
    t.input.write(press(66, '\x02', true) + press(78, 'n'))
    await t.textWith(focused('tidy up the tests'))
    t.input.write(press(66, '\x02', true))
    await sleep(50)
    t.input.write(press(80, 'p'))
    await t.textWith(focused('second job'))
    // a prompt reads encoded keys too
    t.input.write(press(66, '\x02', true) + press(188, ','))
    await t.textWith('Rename tab 2: second job')
    t.input.write(press(8, '') + press(8, '') + press(8, '') + press(83, 'S') + press(13, '\r'))
    await t.textWith(tab(2, 'second S'))
    t.input.write('\x02d')
    await t.tui
  }, 30_000)
})

const plain = (s: string): string => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

describe('tab layout', () => {
  it('puts the brand and the tabs on the first row, a rule under them, the sidebar and panes below', () => {
    const wide = layout(140, 40, false)
    expect(wide.brand).toEqual({ x: 0, y: 0, w: SIDEBAR_W, h: 1 })
    expect(wide.sidebar).toEqual({ x: 0, y: 2, w: SIDEBAR_W, h: 37 })
    expect(wide.tabs).toEqual({ x: SIDEBAR_W + 1, y: 0, w: 140 - SIDEBAR_W - 1, h: 1 })
    // a pane's first row is the rule under the tabs
    expect(wide.panes).toEqual([{ x: SIDEBAR_W + 1, y: 1, w: 140 - SIDEBAR_W - 1, h: 38 }])
    expect(wide.status).toEqual({ x: 0, y: 39, w: 140, h: 1 })
    const split = layout(140, 40, true)
    expect(split.panes).toHaveLength(2)
    expect(split.panes[0].w + 1 + split.panes[1].w).toBe(split.tabs.w)
  })

  it('drops the sidebar below its width, and the split when two panes would not fit', () => {
    expect(layout(SIDEBAR_MIN_COLS - 1, 30, false).sidebar).toBeNull()
    expect(layout(SIDEBAR_MIN_COLS - 1, 30, false).brand).toBeNull()
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

  it('draws numbered tabs and a + of exactly the width: markers in their tone, the active one bold, nothing inverted', () => {
    const tabs = [
      { title: 'fix the parser', tone: 'working' as const, glyph: '⠹', active: false },
      { title: 'bash', tone: 'neutral' as const, glyph: '›', active: true },
      { title: 'review it', tone: 'attention' as const, active: false }
    ]
    const bar = tabBarLayout(tabs, 80)
    expect(plain(bar.text)).toBe(' ⠹ 1 fix the parser  › 2 bash  ● 3 review it '.padEnd(77) + ' + ')
    expect(bar.text).toContain(`\x1b[1;${TONE_SGR.attention}m●`)
    expect(bar.text).toContain(`\x1b[${TONE_SGR.working}m⠹`)
    expect(bar.text).not.toContain('\x1b[7m')
    expect(bar.text).not.toContain(';7m')
    // where each tab and the + sit, for clicks
    expect(bar.spans.map((s) => s.index)).toEqual([0, 1, 2])
    expect(plain(bar.text).slice(bar.spans[1].from, bar.spans[1].to)).toBe(' › 2 bash ')
    expect(bar.plus).toEqual({ from: 77, to: 80 })
    // too many to fit: the active tab stays, arrows say there are more, and the width holds
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `session number ${i + 1}`, tone: 'done' as const, active: i === 9 }))
    const scrolled = plain(tabBar(many, 60))
    expect(scrolled).toHaveLength(60)
    expect(scrolled).toContain('10 session numbe')
    expect(scrolled.startsWith('‹')).toBe(true)
    expect(scrolled.endsWith('› + ')).toBe(true)
    // very narrow: one tab, cut, and no room for the +
    expect(plain(tabBar(many, 11))).toHaveLength(11)
  })

  it('underlines the active tab on the rule and puts the details at its end', () => {
    const r = plain(ruleLine(40, { from: 4, to: 12 }, '#1 · Codex'))
    expect(r).toHaveLength(40)
    expect(r).toBe('─────━━━━━━─────────────── #1 · Codex ──')
    expect(plain(ruleLine(10, null))).toBe('─'.repeat(10))
    expect(tailFit('/home/me/develop/sldev-io', 12)).toBe('…op/sldev-io')
    expect(tailFit('sldev-io', 12)).toBe('sldev-io    ')
  })

  it('marks a shell tab neutral, and an agent by its mission status, with a spinner only while it works', () => {
    expect(paneSignal({ status: 'waiting', shell: true, pid: 3 })).toMatchObject({ tone: 'neutral', label: 'Shell' })
    expect(paneSignal({ status: 'needs-input' }).tone).toBe('attention')
    expect(paneSignal({ status: 'working' }).tone).toBe('working')
    expect(glyph({ status: 'working' }, 0)).toBe('⠋')
    expect(glyph({ status: 'working' }, 1)).toBe('⠙')
    expect(glyph({ status: 'needs-input' })).toBe('●')
    expect(glyph({ status: 'failed' })).toBe('✕')
    expect(glyph({ status: 'waiting', shell: true, pid: 1 })).toBe('›')
    // a group shows what needs the human first
    expect(rollup([{ status: 'working' }, { status: 'needs-input' }, { status: 'waiting', shell: true, pid: 1 }])).toBe('attention')
    expect(rollup([{ status: 'waiting', shell: true, pid: 1 }])).toBe('neutral')
  })
})

const pane = (id: string, over: Partial<PaneInfo>): PaneInfo =>
  ({ id, title: `tab ${id}`, agent: 'codex', agentName: 'Codex', status: 'working', cwd: '/w/app', root: '/w/app', createdAt: 0, brief: '', ...over }) as PaneInfo

describe('agents started by agents', () => {
  it('puts each child straight under the pane that started it, in its group, marked └; ls lists them the same way', () => {
    const panes = [
      pane('1', { title: 'lead' }),
      pane('2', { title: 'other' }),
      // its worktree is its own git top level, but it belongs with its parent
      pane('3', { title: 'part one', spawnedBy: '1', root: '/w/app-wt', cwd: '/w/app-wt' }),
      // its parent is gone: a pane of its own
      pane('4', { title: 'orphan', spawnedBy: '9' })
    ]
    expect(paneTree(panes).map((t) => `${t.pane.id}${t.child ? 'c' : ''}`)).toEqual(['1', '3c', '2', '4'])
    const rows = sidebar({ panes, order: ['1', '2', '3', '4'], active: '2', shown: ['2'] }, SIDEBAR_W, 20).lines.map(plain)
    expect(rows[1]).toMatch(/^ APP +● 4$/)
    expect(rows[2]).toMatch(/^ {2}⠋ 1 lead/)
    expect(rows[4]).toMatch(/^ {2}└⠋ 3 part one/)
    expect(rows[6]).toMatch(/2 other/)
    expect(rows.join('\n')).not.toMatch(/APP-WT/)
  })
})

describe('sidebar', () => {
  const panes = [
    pane('1', { title: 'fix the parser' }),
    pane('2', { title: 'zsh', shell: true, pid: 9, status: 'waiting', cwd: '/w/app' }),
    pane('3', { title: 'review', status: 'needs-input', root: '/w/site', cwd: '/w/site', worktree: { branch: 'review-1', path: '/w/site-wt', base: 'main' } as PaneInfo['worktree'] })
  ]

  it('groups tabs by project, agents before shells, the one in focus with an accent bar and no reverse video', () => {
    const s = sidebar({ panes, order: ['2', '1', '3'], active: '1', shown: ['1'] }, SIDEBAR_W, 20)
    const rows = s.lines.map(plain)
    expect(rows.every((r) => r.length === SIDEBAR_W)).toBe(true)
    expect(s.lines.join('')).not.toContain('\x1b[7m')
    expect(rows[0].trim()).toBe('')
    expect(rows[1]).toMatch(/^ APP +● 2$/)
    expect(rows[2]).toMatch(/^▌ ⠋ 2 fix the parser/)
    expect(rows[3]).toMatch(/^▌ {3}Codex · working/)
    expect(rows[4]).toMatch(/^ {2}› 1 zsh/)
    expect(rows[5]).toMatch(/^ {4}\/w\/app/)
    expect(rows[6].trim()).toBe('')
    expect(rows[7]).toMatch(/^ SITE +● 1$/)
    expect(rows[9]).toMatch(/Codex · needs you · rev/)
    // clicks on either row of a tab pick it
    expect(s.hits.slice(0, 6)).toEqual([null, null, '1', '1', '2', '2'])
    // the footer counts the agents by state
    expect(rows.join('\n')).toMatch(/● 1 need you {2}● 1 working/)
  })

  it('keeps the tab in focus in view when the list is longer than the sidebar', () => {
    const many = Array.from({ length: 20 }, (_, i) => pane(String(i + 1), { title: `job ${i + 1}` }))
    const s = sidebar({ panes: many, order: many.map((p) => p.id), active: '18', shown: ['18'] }, SIDEBAR_W, 12)
    expect(s.lines).toHaveLength(12)
    expect(s.lines.map(plain).join('\n')).toMatch(/▌ \S 18 job 18/)
  })

  it('selects like a terminal: to the end of the first line, whole lines between, a wrapped line copied as one', async () => {
    const term = createTerm(10, 5)
    await new Promise<void>((r) => term.write('first line\r\nabcdefghijklmn\r\nlast', r))
    // "first line" fills 10 columns; abcdefghijklmn wraps onto the third row
    const sel = { a: { x: 6, y: 0 }, b: { x: 1, y: 3 } }
    expect(selectionText(term, sel)).toBe('line\nabcdefghijklmn\nla')
    // dragged backwards: the same text
    expect(selectionText(term, { a: sel.b, b: sel.a })).toBe('line\nabcdefghijklmn\nla')
    expect(inSelection(sel, 5, 0)).toBe(false)
    expect(inSelection(sel, 9, 1)).toBe(true)
    expect(inSelection(sel, 2, 3)).toBe(false)
    // drawn with a background behind the selected cells only
    const drawn = drawTerm(term, { x: 0, y: 0, w: 10, h: 5 }, sel)
    // 24-bit or 256 colours, as the terminal running the tests says
    expect(drawn).toMatch(/;(48;5;24|48;2;38;79;120|7)mline/)
    expect(drawn).not.toMatch(/;(48;5;24|48;2;38;79;120|7)mfirst/)
  })

  it("uses the app's brand gradient, the 256-colour fallback, and tells a light background from a dark one", () => {
    expect(brandAt(0)).toEqual([49, 156, 252])
    expect(brandAt(0.5)).toEqual([0, 208, 151])
    expect(brandAt(1)).toEqual([177, 103, 247])
    // greys go to the grey ramp, colours to the cube
    expect(to256(68, 68, 72)).toBe(238)
    expect(to256(0, 0, 0)).toBe(16)
    expect(to256(49, 156, 252)).toBe(75)
    expect(isLightBackground('rgb:ffff/ffff/ffff')).toBe(true)
    expect(isLightBackground('rgb:1e1e/1e1e/1e1e')).toBe(false)
    expect(isLightBackground('rgb:fd/f6/e3')).toBe(true)
    expect(isLightBackground('?')).toBeNull()
    expect(ellipsis('fix the flaky parser test', 12)).toBe('fix the fla…')
    expect(ellipsis('short', 8)).toBe('short   ')
  })

  it('draws a popup inside its area with its rows, the picked one marked', () => {
    const p = plain(popup({ x: 0, y: 0, w: 80, h: 20 }, 'New tab', [{ key: 't', text: 'Shell' }, { key: '1', text: 'Claude Code', off: true, note: 'not installed' }], 0))
    expect(p).toContain('╭─ New tab')
    expect(p).toContain('▌ t  Shell')
    expect(p).toMatch(/1 {2}Claude Code +not installed/)
  })
})

describe("the app's look: painted surfaces, the 256 fallback, the light ladder and the opt-outs", () => {
  let before: ReturnType<typeof R.setColorMode>
  beforeEach(() => (before = R.setColorMode({ truecolor: true, paint: true, noColor: false })))
  afterEach(() => {
    R.setLight(false)
    R.setColorMode(before)
  })
  const tabs = [
    { title: 'fix', tone: 'working' as const, glyph: '⠹', active: true },
    { title: 'zsh', tone: 'neutral' as const, glyph: '›', active: false }
  ]

  it("paints the frame, panes and popups from the app's dark ladder", () => {
    expect(R.DARK.background).toEqual([10, 10, 10])
    expect(R.DARK.surface).toEqual([17, 17, 17])
    expect(R.DARK.raised).toEqual([25, 25, 25])
    expect(R.SURFACE).toContain('48;2;17;17;17')
    expect(R.PANE).toContain('48;2;10;10;10')
    expect(R.RAISED).toContain('48;2;25;25;25')
    expect(R.MUTED).toContain('48;2;32;32;32')
    // the bar on the surface, the tab in front lifted onto the raised tone; markers keep their tone
    const bar = tabBarLayout(tabs, 60).text
    expect(bar.startsWith(R.SURFACE)).toBe(true)
    expect(bar).toContain(R.RAISED)
    expect(bar).toContain(`\x1b[${TONE_SGR.working}m⠹`)
    expect(plain(bar)).toHaveLength(60)
    // the sidebar row in focus is raised, the others on the surface
    const s = sidebar({ panes: [pane('1', { title: 'one' }), pane('2', { title: 'two' })], order: ['1', '2'], active: '1', shown: ['1'] }, SIDEBAR_W, 10)
    expect(s.lines[2].startsWith(R.RAISED)).toBe(true)
    expect(s.lines[4].startsWith(R.SURFACE)).toBe(true)
    // the key chips sit on the muted tone and read as before
    const h = R.hints([['c', 'new tab']], 30, ' ^b ')
    expect(h).toContain(R.MUTED)
    expect(plain(h)).toBe(' ^b c new tab'.padEnd(30))
  })

  it('frames edges in the brand gradient: soft along long edges, full on popups, plain rules grey', () => {
    const edge = R.vEdge(28, 1, 20, '┬')
    expect(plain(edge)).toBe('┬' + '│'.repeat(19))
    // softened toward the rule tone, blue at the top and purple at the bottom
    const top = R.brandAt(0).map((v, k) => Math.round(v + (R.DARK.rule[k] - v) * 0.45))
    expect(edge).toContain(`38;2;${top.join(';')}m┬`)
    // built once per size
    expect(R.vEdge(28, 1, 20, '┬')).toBe(edge)
    const p = popup({ x: 0, y: 0, w: 80, h: 20 }, 'Keys', [{ key: 'c', text: 'new tab' }], -1)
    expect(p).toContain(`38;2;${R.brandAt(0).join(';')}m╭`)
    expect(p).toContain(R.RAISED)
    expect(ruleLine(20, null)).toContain(`38;2;${R.DARK.rule.join(';')}m─`)
  })

  it('gives only default-coloured pane cells the pane tones, and leaves what a program paints alone', async () => {
    const term = createTerm(20, 3)
    await new Promise<void>((r) => term.write('plain\x1b[41mred\x1b[0m\x1b[7minv\x1b[0m', r))
    const drawn = drawTerm(term, { x: 0, y: 0, w: 20, h: 3 })
    expect(drawn).toMatch(/48;2;10;10;10mplain/)
    expect(drawn).toMatch(/;41mred/)
    expect(drawn).toMatch(/;7;39;49minv/)
  })

  it('falls back to 256-colour greys without truecolor, and uses the light ladder on a light terminal', () => {
    R.setColorMode({ truecolor: false })
    expect(R.PANE).toContain('48;5;232')
    expect(R.SURFACE).toContain('48;5;233')
    expect(R.RAISED).toContain('48;5;234')
    expect(R.SURFACE).not.toContain(';2;')
    R.setLight(true)
    expect(R.ladder).toBe(R.LIGHT)
    expect(R.PANE).toContain('48;5;231')
    expect(R.SURFACE).toContain('48;5;255')
    R.setColorMode({ truecolor: true })
    expect(R.SURFACE).toContain('48;2;246;246;246')
    expect(R.RAISED).toContain('48;2;238;238;238')
    // never a dark fill on a light screen
    expect(R.SURFACE + R.PANE + R.RAISED + R.MUTED).not.toMatch(/48;2;(10|17|25|32);/)
  })

  it('draws on the terminal background with SLDEV_THEME=terminal, and without any colour under NO_COLOR', async () => {
    R.setColorMode({ paint: false })
    expect(R.painted()).toBe(false)
    expect(R.SURFACE + R.PANE).toBe('')
    expect(tabBarLayout(tabs, 60).text).not.toContain('48;')
    expect(R.vEdge(28, 1, 5)).toContain(`38;2;68;68;72m`)
    const term = createTerm(10, 2)
    await new Promise<void>((r) => term.write('hi', r))
    expect(drawTerm(term, { x: 0, y: 0, w: 10, h: 2 })).toMatch(/;39;49mhi/)
    R.setColorMode({ noColor: true })
    const p = R.stripColor(popup({ x: 0, y: 0, w: 80, h: 20 }, 'New tab', [{ key: 't', text: 'Shell' }], 0) + tabBar(tabs, 60))
    expect(p).not.toMatch(/\x1b\[[0-9;]*(3[0-9]|4[0-9]|9[0-7])[;m]/)
    expect(p).toContain('\x1b[1m')
    expect(plain(p)).toContain('╭─ New tab')
  })
})

describe('briefs in the TUI', () => {
  it('Ctrl-b b lists the waiting briefs and Enter launches one; Ctrl-e in the brief prompt writes one in the editor', async () => {
    const dir = join(work, '.sldev-cli', 'briefs')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a-broken.md'), '---\ntitle: Broken one\nkind: nope\n---\nsomething\n')
    writeFileSync(join(dir, 'hello.md'), '---\ntitle: Say hello\nagent: codex\nworktree: false\ncriteria:\n  - prints hello\n---\nPrint hello.\n')
    // the editor is a fake: the first time it writes a brief, the second it leaves the template as it was
    const edits: string[] = []
    const edit = async (file: string): Promise<void> => {
      edits.push(file)
      if (edits.length === 1) writeFileSync(file, readFileSync(file, 'utf8').replace('title: ', 'title: From the editor') + 'Write a haiku.\n')
    }
    const t = await attachTui(110, 30, { edit })
    await t.textWith('^b c new tab')

    t.input.write('\x02b')
    let s = await t.textWith('Briefs')
    expect(s).toContain('Say hello')
    expect(s).toMatch(/a-broken +can't launch, Enter says why/)
    expect(s).toContain('Enter launch')
    // a number doesn't launch anything here: only Enter on the brief in focus
    t.input.write('1')
    await sleep(300)
    expect(existsSync(join(dir, 'hello.md'))).toBe(true)
    // the first one that can launch is in focus; the broken one says why and stays
    t.input.write('\x1b[A')
    t.input.write('\r')
    await t.textWith(/a-broken can't launch: Unknown kind "nope"/)
    expect(existsSync(join(dir, 'a-broken.md'))).toBe(true)

    t.input.write('\x02b')
    await t.textWith('Briefs')
    t.input.write('\r')
    s = await t.textWith(/Started brief \d+: Say hello/)
    expect(existsSync(join(dir, 'hello.md'))).toBe(false)
    expect(readdirSync(join(dir, 'launched'))).toEqual(['hello.md'])
    const hello = (await c.request('ls', {})).find((p) => p.title === 'Say hello')!
    expect(hello.prompt).toContain('Acceptance criteria:\n- prints hello')

    // Ctrl-b c, Codex, then Ctrl-e: the template in the editor, launched once saved
    t.input.write('\x02c')
    await t.textWith('New tab')
    t.input.write('2')
    await t.textWith('Ctrl-e writes a longer one')
    t.input.write('\x05')
    await t.textWith(/Started brief \d+: From the editor/)
    expect(edits[0]).toMatch(/\.new-\d+\.md$/)
    expect(existsSync(edits[0])).toBe(false)
    expect(readdirSync(join(dir, 'launched')).sort()).toEqual(['from-the-editor.md', 'hello.md'])
    const fromEditor = (await c.request('ls', {})).find((p) => p.title === 'From the editor')!
    expect(fromEditor.agentName).toBe('Codex')
    expect(fromEditor.prompt).toContain('Write a haiku.')

    // left empty: nothing starts and the template is gone
    t.input.write('\x02c')
    await t.textWith('New tab')
    t.input.write('2')
    await t.textWith('Ctrl-e writes a longer one')
    t.input.write('\x05')
    await t.textWith('The brief was empty, so nothing started')
    expect(readdirSync(dir).filter((f) => f.startsWith('.new-'))).toEqual([])
    for (const p of [hello, fromEditor]) await c.request('kill', { pane: p.id })
    t.input.write('\x02d')
    await t.tui
  }, 40_000)
})
