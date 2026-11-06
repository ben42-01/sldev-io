import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PassThrough, Writable } from 'stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, type Client } from '../src/client'
import { startDaemon, type Daemon } from '../src/daemon'
import { useFakeAgents } from './fakePath'
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
  rmSync(tmp, { recursive: true, force: true })
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
    const tui = runTui(await connect({ dataDir: data, script: '', start: false }), work, { input, output })
    const text = async (): Promise<string> => {
      await sleep(300)
      await written
      return screenText(screen, 30)
    }

    let s = await text()
    expect(s).toContain('sldev')
    expect(s).toContain('1 tidy up the tests')
    expect(s).toMatch(/Codex · (Working|Starting|Ready for you)/)
    // the pane's screen: the fake codex echoes its argv, then thinks
    expect(s).toContain('thinking 1')
    expect(s).toContain('Ctrl-b then')

    input.write('\x02c')
    expect(await text()).toContain('New pane (agent, then the brief):')
    input.write('codex second job')
    input.write('\r')
    s = await text()
    expect(s).toContain('2 second job')

    input.write('\x02s')
    s = await text()
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
    expect(await text()).toContain('Detached. The agents keep running')
    // detaching leaves the agents running
    expect((await c.request('ls', {})).map((p) => p.status)).not.toContain('ended')
  }, 30_000)
})
