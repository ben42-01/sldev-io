import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough, Writable } from 'stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, type Client } from '../src/client'
import { startDaemon, type Daemon } from '../src/daemon'
import { useFakeAgents } from './fakePath'
import type { TuiServices } from '../src/tui'
import { createTerm, screenText } from '../src/screen'
import { runTui } from '../src/tui'

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
  rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
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
    s = await textWith('│● 2 second job')
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
