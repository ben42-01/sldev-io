import { spawn } from 'child_process'
import { mkdirSync, openSync } from 'fs'
import { createConnection, type Socket } from 'net'
import { join } from 'path'
import { lineReader, type Command, type DaemonEvent, type Requests, type Response } from './protocol'
import { cliDir, socketPath } from './paths'

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

  request<C extends Command>(cmd: C, args: Requests[C][0]): Promise<Requests[C][1]> {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
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

/**
 * Connects to the daemon, starting it in the background first when it isn't running (`sldev serve`,
 * detached, logging to <data>/cli/daemon.log). `script` is this CLI's entry file.
 */
export async function connect(o: { dataDir: string; script: string; start?: boolean }): Promise<Client> {
  const dir = cliDir(o.dataDir)
  const socket = socketPath(dir)
  const c = await tryConnect(socket)
  if (c || o.start === false) {
    if (c) return c
    throw new Error('sldev is not running')
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const log = openSync(join(dir, 'daemon.log'), 'a')
  spawn(process.execPath, [o.script, 'serve'], { detached: true, stdio: ['ignore', log, log], env: { ...process.env, SLDEV_DATA_DIR: o.dataDir } }).unref()
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100))
    const c2 = await tryConnect(socket)
    if (c2) return c2
  }
  throw new Error(`The sldev daemon didn't start; see ${join(dir, 'daemon.log')}`)
}
