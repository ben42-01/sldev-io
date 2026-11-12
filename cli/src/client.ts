import { spawn } from 'child_process'
import { mkdirSync, openSync } from 'fs'
import { createConnection, type Socket } from 'net'
import { join } from 'path'
import { lineReader, type Command, type DaemonEvent, type PaneInfo, type Requests, type Response } from './protocol'
import { cliDir, socketPath } from './paths'
import { VERSION } from './version'

/** A connection to the daemon: requests get their reply by id; events (attach) go to onEvent. */
export class Client {
  private seq = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private listeners: Array<(e: DaemonEvent) => void> = []

  constructor(private sock: Socket) {
    sock.on(
      'data',
      lineReader((m) => {
        if (m && typeof m === 'object' && 'event' in m) return this.listeners.forEach((l) => l(m as DaemonEvent))
        const msg = m as Response
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.ok) p.resolve(msg.result)
        else p.reject(new Error(msg.error))
      })
    )
    const fail = (): void => {
      for (const p of this.pending.values()) p.reject(new Error('The sldev daemon closed the connection'))
      this.pending.clear()
    }
    sock.on('close', fail)
    sock.on('error', fail)
  }

  /**
   * A request and its reply. With `timeoutMs` a daemon that never answers is an error instead of a wait
   * forever: a daemon left running from an older sldev ignored commands it didn't know, and the TUI hung.
   */
  request<C extends Command>(cmd: C, args: Requests[C][0], timeoutMs?: number): Promise<Requests[C][1]> {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = timeoutMs ? setTimeout(() => {
        if (!this.pending.delete(id)) return
        reject(new Error(`The sldev daemon didn't answer "${cmd}"; sldev stop, then try again`))
      }, timeoutMs) : undefined
      const done = <T>(fn: (v: T) => void) => (v: T): void => (clearTimeout(timer), fn(v))
      this.pending.set(id, { resolve: done(resolve as (v: unknown) => void), reject: done(reject) })
      this.sock.write(JSON.stringify({ id, cmd, args }) + '\n')
    })
  }

  onEvent(fn: (e: DaemonEvent) => void): void {
    this.listeners.push(fn)
  }

  onClose(fn: () => void): void {
    this.sock.on('close', fn)
  }

  close(): void {
    this.sock.end()
  }
}

export function tryConnect(socket: string): Promise<Client | null> {
  return new Promise((resolve) => {
    const s = createConnection(socket)
    s.once('connect', () => resolve(new Client(s)))
    s.once('error', () => resolve(null))
  })
}

/** how long a quick request (the version check, ls, stop) may take before the daemon counts as stuck */
const QUICK_MS = 3000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Polls until nothing answers on the socket any more; false if something still does after `ms`. */
async function gone(socket: string, ms: number): Promise<boolean> {
  for (let t = 0; t < ms; t += 100) {
    const c = await tryConnect(socket)
    if (!c) return true
    c.close()
    await sleep(100)
  }
  return false
}

/**
 * The daemon on the socket must be this sldev's version. One left running by an older install answers what
 * it knew (ls, attach) and stays silent on anything newer, so after an upgrade `sldev` hung on a blank
 * screen. A stale daemon with nothing running in it is stopped and replaced; one with live panes is left
 * alone (stopping it would kill agents mid-work), and the error says how to restart it.
 */
async function checkVersion(c: Client, socket: string): Promise<{ ok: true } | { ok: false; was: string }> {
  const info = await c.request('ping', {}, QUICK_MS).catch(() => null)
  if (info?.version === VERSION) return { ok: true }
  const was = info?.version ? `sldev ${info.version}` : 'an older sldev'
  const panes: PaneInfo[] = await c.request('ls', {}, QUICK_MS).catch(() => [])
  const live = panes.filter((p) => p.pid !== undefined)
  if (live.length) {
    c.close()
    throw new Error(
      `the background daemon is from ${was} and still runs ${live.length} pane${live.length === 1 ? '' : 's'} (${live.map((p) => `${p.id} ${p.title}`).join(', ')}). ` +
        `This is sldev ${VERSION}. Let them finish, then run "sldev stop" (it ends them) and "sldev" again.`
    )
  }
  await c.request('stop', {}, QUICK_MS).catch(() => undefined)
  c.close()
  if (!(await gone(socket, 3000)) && info?.pid) {
    try {
      process.kill(info.pid, 'SIGTERM')
    } catch {
      // already gone
    }
    await gone(socket, 2000)
  }
  return { ok: false, was }
}

/**
 * Connects to the daemon, starting it in the background first when it isn't running (`sldev serve`,
 * detached, logging to <data>/cli/daemon.log). `script` is this CLI's entry file. A daemon of another
 * version is replaced first (see checkVersion); `check: false` skips that, for `sldev stop`.
 */
export async function connect(o: { dataDir: string; script: string; start?: boolean; check?: boolean; onRestart?: (was: string) => void }): Promise<Client> {
  const dir = cliDir(o.dataDir)
  const socket = socketPath(dir)
  const c = await tryConnect(socket)
  if (c) {
    // sldev stop must reach a daemon of any version
    if (o.check === false) return c
    const v = await checkVersion(c, socket)
    if (v.ok) return c
    o.onRestart?.(v.was)
  }
  if (o.start === false) throw new Error('sldev is not running')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const log = openSync(join(dir, 'daemon.log'), 'a')
  // windowsHide: a detached process on Windows otherwise gets a console window of its own
  spawn(process.execPath, [o.script, 'serve'], { detached: true, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, SLDEV_DATA_DIR: o.dataDir } }).unref()
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100))
    const c2 = await tryConnect(socket)
    if (c2) return c2
  }
  throw new Error(`The sldev daemon didn't start; see ${join(dir, 'daemon.log')}`)
}
