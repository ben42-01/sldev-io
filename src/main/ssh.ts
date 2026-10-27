import { app, ipcMain, type WebContents } from 'electron'
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { connect as netConnect, createServer, type Server } from 'net'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { PortForward, RemoteEntry, SshConnection, SshPrompt } from '@shared/types'
import { JsonStore } from './store'
import { ensureKeyFileCredential, resolveCredential, type ResolvedAuth } from './vault'

const FLUSH_MS = 8
const HIGH_WATER = 1024 * 1024
const LOW_WATER = 256 * 1024

interface Shell {
  stream: ClientChannel | null
  owner: WebContents
  connId: string
  buffer: string
  timer: NodeJS.Timeout | null
  unacked: number
  paused: boolean
  closed: boolean
}

interface Conn {
  client: Client
  ready: Promise<Client>
  jump?: Conn
  sftp?: Promise<SFTPWrapper>
  refs: number
}

let promptSeq = 0
const pending = new Map<string, (answer: string[] | null) => void>()

ipcMain.on('ssh:prompt-reply', (_e, requestId: string, answer: string[] | null) => {
  pending.get(requestId)?.(answer)
  pending.delete(requestId)
})

function ask(owner: WebContents, p: Omit<SshPrompt, 'requestId'>): Promise<string[] | null> {
  const requestId = `p${++promptSeq}`
  return new Promise((resolve) => {
    pending.set(requestId, resolve)
    owner.send('ssh:prompt', { ...p, requestId })
  })
}

export class SshManager {
  private shells = new Map<string, Shell>()
  private conns = new Map<string, Conn>()
  private forwards = new Map<string, Server>()
  private knownHosts = new JsonStore<{ hosts: Record<string, string> }>('known_hosts', { hosts: {} })

  constructor(private connections: () => SshConnection[]) {}

  has(id: string): boolean {
    return this.shells.has(id)
  }

  connectedIds(): string[] {
    return [...this.conns.keys()]
  }

  async openShell(owner: WebContents, id: string, connId: string, cols: number, rows: number): Promise<void> {
    this.kill(id)
    const sh: Shell = { stream: null, owner, connId, buffer: '', timer: null, unacked: 0, paused: false, closed: false }
    this.shells.set(id, sh)
    const conn = await this.connect(owner, connId)
    const def = this.connections().find((c) => c.id === connId)
    const stream = await new Promise<ClientChannel>((resolve, reject) =>
      conn.client.shell({ term: 'xterm-256color', cols, rows }, (err, s) => (err ? reject(err) : resolve(s)))
    )
    if (this.shells.get(id) !== sh) {
      stream.close()
      return
    }
    sh.stream = stream
    conn.refs++
    const onData = (d: Buffer): void => {
      sh.buffer += d.toString('utf8')
      sh.unacked += d.length
      if (!sh.paused && sh.unacked > HIGH_WATER) {
        sh.paused = true
        stream.pause()
      }
      if (!sh.timer) sh.timer = setTimeout(() => this.flush(id, sh), FLUSH_MS)
    }
    stream.on('data', onData)
    stream.stderr.on('data', onData)
    stream.on('close', (code: number | null) => {
      this.flush(id, sh)
      if (this.shells.get(id) === sh) this.shells.delete(id)
      if (!sh.closed) {
        sh.closed = true
        this.release(connId)
        if (!owner.isDestroyed()) owner.send('pty:exit', id, code ?? 0)
      }
    })
    if (def?.remoteDir) stream.write(`cd ${JSON.stringify(def.remoteDir)}\r`)
  }

  write(id: string, data: string): void {
    this.shells.get(id)?.stream?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.shells.get(id)?.stream?.setWindow(rows, cols, 0, 0)
  }

  ack(id: string, bytes: number): void {
    const sh = this.shells.get(id)
    if (!sh) return
    sh.unacked = Math.max(0, sh.unacked - bytes)
    if (sh.paused && sh.unacked < LOW_WATER) {
      sh.paused = false
      sh.stream?.resume()
    }
  }

  kill(id: string): void {
    const sh = this.shells.get(id)
    if (!sh) return
    this.shells.delete(id)
    if (sh.timer) clearTimeout(sh.timer)
    if (!sh.closed && sh.stream) {
      sh.closed = true
      sh.stream.close()
      this.release(sh.connId)
    }
  }

  killOwnedBy(owner: WebContents): void {
    for (const [id, sh] of this.shells) if (sh.owner === owner) this.kill(id)
  }

  disconnectAll(): void {
    for (const id of [...this.shells.keys()]) this.kill(id)
    for (const s of this.forwards.values()) s.close()
    this.forwards.clear()
    for (const c of this.conns.values()) c.client.end()
    this.conns.clear()
  }

  disconnect(connId: string): void {
    for (const [id, sh] of this.shells) if (sh.connId === connId) this.kill(id)
    for (const [key, s] of this.forwards) if (key.startsWith(`${connId}/`)) (s.close(), this.forwards.delete(key))
    const c = this.conns.get(connId)
    if (c) {
      c.client.end()
      this.conns.delete(connId)
    }
  }

  // ── SFTP ─────────────────────────────────────

  async home(owner: WebContents, connId: string): Promise<string> {
    const sftp = await this.sftp(owner, connId)
    return new Promise((resolve, reject) => sftp.realpath('.', (err, p) => (err ? reject(err) : resolve(p))))
  }

  async list(owner: WebContents, connId: string, path: string): Promise<RemoteEntry[]> {
    const sftp = await this.sftp(owner, connId)
    const items = await new Promise<Array<{ filename: string; attrs: { mode: number; size: number } }>>((resolve, reject) =>
      sftp.readdir(path, (err, list) => (err ? reject(err) : resolve(list)))
    )
    const join2 = (a: string, b: string): string => (a.endsWith('/') ? a + b : `${a}/${b}`)
    return items
      .filter((i) => i.filename !== '.' && i.filename !== '..')
      .map((i) => ({ name: i.filename, path: join2(path, i.filename), isDir: (i.attrs.mode & 0o170000) === 0o040000, size: i.attrs.size }))
      .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)))
  }

  async download(owner: WebContents, connId: string, remotePath: string): Promise<string> {
    const sftp = await this.sftp(owner, connId)
    const base = remotePath.split('/').pop() || 'download'
    let local = join(app.getPath('downloads'), base)
    for (let i = 2; existsSync(local); i++) local = join(app.getPath('downloads'), `${i}-${base}`)
    await new Promise<void>((resolve, reject) => sftp.fastGet(remotePath, local, (err) => (err ? reject(err) : resolve())))
    return local
  }

  // ── port forwarding ──────────────────────────

  activeForwards(): string[] {
    return [...this.forwards.keys()]
  }

  async startForward(owner: WebContents, connId: string, fwd: PortForward): Promise<void> {
    const key = `${connId}/${fwd.id}`
    if (this.forwards.has(key)) return
    const conn = await this.connect(owner, connId)
    const server = createServer((sock) => {
      conn.client.forwardOut('127.0.0.1', sock.remotePort ?? 0, fwd.remoteHost, fwd.remotePort, (err, stream) => {
        if (err) return sock.destroy()
        sock.pipe(stream).pipe(sock)
        sock.on('error', () => stream.close())
        stream.on('error', () => sock.destroy())
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(fwd.localPort, '127.0.0.1', () => resolve())
    })
    this.forwards.set(key, server)
  }

  stopForward(connId: string, fwdId: string): void {
    const key = `${connId}/${fwdId}`
    this.forwards.get(key)?.close()
    this.forwards.delete(key)
  }

  // ── connection handling ──────────────────────

  private async sftp(owner: WebContents, connId: string): Promise<SFTPWrapper> {
    const conn = await this.connect(owner, connId)
    if (!conn.sftp) {
      conn.sftp = new Promise((resolve, reject) => conn.client.sftp((err, s) => (err ? reject(err) : resolve(s))))
      conn.sftp.catch(() => (conn.sftp = undefined))
    }
    return conn.sftp
  }

  private release(connId: string): void {
    const c = this.conns.get(connId)
    if (c) c.refs = Math.max(0, c.refs - 1)
  }

  private connect(owner: WebContents, connId: string, depth = 0): Promise<Conn> {
    const existing = this.conns.get(connId)
    if (existing) return existing.ready.then(() => existing)
    const def = this.connections().find((c) => c.id === connId)
    if (!def) return Promise.reject(new Error('Unknown connection'))
    if (depth > 4) return Promise.reject(new Error('Jump host chain is too long'))

    const client = new Client()
    const conn: Conn = { client, refs: 0, ready: null as unknown as Promise<Client> }
    this.conns.set(connId, conn)
    conn.ready = (async () => {
      let auth: ResolvedAuth = {}
      if (def.auth === 'credential' && def.credentialId) auth = await resolveCredential(def.credentialId)
      const username = def.username || auth.username
      if (!username) throw new Error('No username set for this connection')
      if (def.auth === 'prompt') {
        const a = await ask(owner, { kind: 'secret', title: `Password for ${username}@${def.host}`, message: '', fields: [{ label: 'Password', secret: true }] })
        if (!a) throw new Error('Cancelled')
        auth.password = a[0]
      }
      let sock: NodeJS.ReadableStream | undefined
      if (def.jumpId) {
        const jump = await this.connect(owner, def.jumpId, depth + 1)
        conn.jump = jump
        sock = await new Promise((resolve, reject) =>
          jump.client.forwardOut('127.0.0.1', 0, def.host, def.port || 22, (err, s) => (err ? reject(err) : resolve(s)))
        )
      }
      const cfg: ConnectConfig = {
        host: def.host,
        port: def.port || 22,
        username,
        password: auth.password,
        privateKey: auth.privateKey,
        passphrase: auth.passphrase,
        agent: def.auth === 'agent' ? (process.platform === 'win32' ? 'pageant' : process.env.SSH_AUTH_SOCK) : undefined,
        tryKeyboard: true,
        keepaliveInterval: 15000,
        readyTimeout: 20000,
        sock: sock as ConnectConfig['sock'],
        hostHash: 'sha256',
        hostVerifier: (hash: string, cb: (ok: boolean) => void) => void this.verifyHost(owner, def, hash).then(cb)
      } as unknown as ConnectConfig // async fingerprint verifier: must return undefined, which the typings disallow
      client.on('keyboard-interactive', (_name, instructions, _lang, prompts, finish) => {
        if (auth.password && prompts.length === 1 && !prompts[0].echo) return finish([auth.password])
        if (!prompts.length) return finish([])
        void ask(owner, {
          kind: 'secret',
          title: `${username}@${def.host}`,
          message: instructions || 'The server asks for:',
          fields: prompts.map((p) => ({ label: p.prompt.replace(/:\s*$/, ''), secret: !p.echo }))
        }).then((a) => finish(a ?? []))
      })
      await new Promise<void>((resolve, reject) => {
        client.once('ready', () => resolve())
        client.once('error', (err) => reject(err))
        client.connect(cfg)
      })
      client.on('close', () => {
        if (this.conns.get(connId) === conn) this.conns.delete(connId)
        for (const [key, s] of this.forwards) if (key.startsWith(`${connId}/`)) (s.close(), this.forwards.delete(key))
      })
      client.on('error', () => {})
      return client
    })()
    conn.ready.catch(() => {
      if (this.conns.get(connId) === conn) this.conns.delete(connId)
      client.end()
    })
    return conn.ready.then(() => conn)
  }

  private async verifyHost(owner: WebContents, def: SshConnection, hash: string): Promise<boolean> {
    const key = `[${def.host}]:${def.port || 22}`
    const fp = `SHA256:${Buffer.from(hash, 'hex').toString('base64').replace(/=+$/, '')}`
    const known = this.knownHosts.get().hosts[key]
    if (known === fp) return true
    const answer = await ask(owner, {
      kind: known ? 'confirm' : 'hostkey',
      title: known ? `HOST KEY CHANGED for ${def.host}` : `Trust ${def.host}?`,
      message: known
        ? `The host key for ${key} no longer matches the one saved before.\n\nSaved:  ${known}\nNow:    ${fp}\n\nThis can mean someone is intercepting the connection. Only continue if you know the server's key was changed.`
        : `First connection to ${key}.\nKey fingerprint: ${fp}\n\nCheck this matches the server before trusting it.`
    })
    if (!answer) return false
    this.knownHosts.set({ hosts: { ...this.knownHosts.get().hosts, [key]: fp } })
    return true
  }

  private flush(id: string, sh: Shell): void {
    if (sh.timer) clearTimeout(sh.timer)
    sh.timer = null
    if (!sh.buffer) return
    const data = sh.buffer
    sh.buffer = ''
    if (!sh.owner.isDestroyed()) sh.owner.send('pty:data', id, data)
  }
}

/** Parse ~/.ssh/config Host blocks (no wildcards) into connections; IdentityFiles become key-file credentials. */
export async function importSshConfig(existing: SshConnection[]): Promise<SshConnection[]> {
  const file = join(homedir(), '.ssh', 'config')
  if (!existsSync(file)) return []
  const blocks: Array<{ alias: string; opts: Record<string, string> }> = []
  let cur: { alias: string; opts: Record<string, string> } | null = null
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(\S+)\s*=?\s*(.+)$/.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    if (key === 'host') {
      cur = null
      const alias = m[2].split(/\s+/).find((a) => !/[*?!]/.test(a))
      if (alias) blocks.push((cur = { alias, opts: {} }))
    } else if (key === 'match') cur = null
    else if (cur && !(key in cur.opts)) cur.opts[key] = m[2].replace(/^"|"$/g, '')
  }
  const out: SshConnection[] = []
  const idFor = (alias: string): string => `ssh-${alias.replace(/[^\w-]/g, '_')}`
  for (const b of blocks) {
    if (existing.some((c) => c.name === b.alias)) continue
    const user = b.opts.user
    const keyPath = b.opts.identityfile
    out.push({
      id: idFor(b.alias),
      name: b.alias,
      host: b.opts.hostname ?? b.alias,
      port: Number(b.opts.port) || 22,
      username: user,
      auth: keyPath ? 'credential' : 'agent',
      credentialId: keyPath ? await ensureKeyFileCredential(keyPath, user) : undefined,
      jumpId: b.opts.proxyjump && blocks.some((x) => x.alias === b.opts.proxyjump) ? idFor(b.opts.proxyjump) : undefined,
      forwards: []
    })
  }
  return out
}

/** Whether the SSH port answers (a TCP connect, nothing is sent): round-trip ms, or why it didn't. */
export function ping(host: string, port: number, timeoutMs = 4000): Promise<{ ms: number } | { error: string }> {
  return new Promise((resolve) => {
    const start = Date.now()
    const sock = netConnect({ host, port })
    const done = (r: { ms: number } | { error: string }): void => {
      sock.destroy()
      resolve(r)
    }
    sock.setTimeout(timeoutMs, () => done({ error: 'timeout' }))
    sock.once('connect', () => done({ ms: Date.now() - start }))
    sock.once('error', (e: NodeJS.ErrnoException) => done({ error: e.code === 'ENOTFOUND' ? 'host not found' : e.code === 'ECONNREFUSED' ? 'refused' : (e.code ?? e.message) }))
  })
}
