import { useEffect, useState } from 'react'
import type { CredentialInput, CredentialKind, CredentialMeta, PortForward, RemoteEntry, SshConnection, VaultStatus } from '@shared/types'
import { ArrowRightLeft, ChevronRight, Copy, Download, File, Folder, FolderTree, Import, KeyRound, Pencil, Plug, Plus, ShieldAlert, SquareTerminal, Trash2, Unplug } from 'lucide-react'
import { loadRemote, newId, openSshTerminal, refreshRemoteState, reloadCredentials, remote, saveConnections } from '../state/remote'
import { useStore } from '../state/store'
import { showContextMenu } from './ContextMenu'
import { ViewShell } from './RuntimesView'
import { Containers } from './Containers'

const errText = (e: unknown): string => String(e).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')

export function RemoteView(): React.JSX.Element {
  const [tab, setTab] = useState<'connections' | 'credentials' | 'containers'>('connections')
  const [vault, setVault] = useState<VaultStatus | null>(null)
  const loaded = useStore(remote, (r) => r.loaded)

  useEffect(() => {
    if (!loaded) void loadRemote()
    void window.api.vault.status().then(setVault)
    const t = setInterval(() => void refreshRemoteState(), 4000)
    return () => clearInterval(t)
  }, [loaded])

  return (
    <ViewShell title="Remote">
      <div className="tabs">
        <button className={tab === 'connections' ? 'on' : ''} onClick={() => setTab('connections')}>Connections</button>
        <button className={tab === 'credentials' ? 'on' : ''} onClick={() => setTab('credentials')}>Credentials</button>
        <button className={tab === 'containers' ? 'on' : ''} onClick={() => setTab('containers')}>Containers</button>
      </div>
      {vault && !vault.encrypted && tab !== 'containers' && (
        <div className="warn-banner">
          <ShieldAlert size={14} />
          <span>No OS keychain found (backend: {vault.backend}). Saved passwords and keys can't be encrypted securely; install/unlock a keyring (e.g. gnome-keyring) or use ssh-agent.</span>
        </div>
      )}
      {tab === 'connections' ? <Connections onNeedCredential={() => setTab('credentials')} /> : tab === 'credentials' ? <Credentials /> : <Containers />}
    </ViewShell>
  )
}

// ── connections ──────────────────────────────────────────────────

function Connections({ onNeedCredential }: { onNeedCredential: () => void }): React.JSX.Element {
  const connections = useStore(remote, (r) => r.connections)
  const connected = useStore(remote, (r) => r.connected)
  const [editing, setEditing] = useState<SshConnection | null>(null)
  const [browsing, setBrowsing] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const importConfig = async (): Promise<void> => {
    const found = await window.api.ssh.importConfig()
    await saveConnections([...remote.get().connections, ...found])
    await reloadCredentials()
    setNotice(found.length ? `Imported ${found.length} host${found.length === 1 ? '' : 's'} from ~/.ssh/config` : 'Nothing new to import from ~/.ssh/config')
  }

  if (editing) {
    return (
      <ConnectionForm
        initial={editing}
        onNeedCredential={onNeedCredential}
        onCancel={() => setEditing(null)}
        onSave={(c) => {
          const list = remote.get().connections
          void saveConnections(list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c])
          setEditing(null)
        }}
      />
    )
  }

  return (
    <div className="view-scroll">
      <div className="view-footer row">
        <button className="btn sm primary" onClick={() => setEditing({ id: newId('ssh'), name: '', host: '', port: 22, auth: 'agent', forwards: [] })}>
          <Plus size={13} /> New connection
        </button>
        <button className="btn sm" onClick={() => void importConfig()} title="Import hosts from ~/.ssh/config">
          <Import size={13} /> Import
        </button>
      </div>
      {notice && <div className="muted-note">{notice}</div>}
      {connections.map((c) => {
        const isUp = connected.includes(c.id)
        return (
          <div key={c.id}>
            <div
              className="rt-row"
              onDoubleClick={() => openSshTerminal(c)}
              onContextMenu={(e) =>
                showContextMenu(e, [
                  { label: 'Open terminal', icon: <SquareTerminal size={13} />, run: () => openSshTerminal(c) },
                  { label: browsing === c.id ? 'Hide files' : 'Browse files', icon: <FolderTree size={13} />, run: () => setBrowsing(browsing === c.id ? null : c.id) },
                  { label: 'Disconnect', icon: <Unplug size={13} />, disabled: !isUp, run: () => void window.api.ssh.disconnect(c.id).then(refreshRemoteState) },
                  { type: 'separator' },
                  { label: 'Edit', icon: <Pencil size={13} />, run: () => setEditing(c) },
                  { label: 'Duplicate', icon: <Copy size={13} />, run: () => void saveConnections([...connections, { ...c, id: newId('ssh'), name: `${c.name} copy` }]) },
                  { label: 'Delete', icon: <Trash2 size={13} />, run: () => void saveConnections(connections.filter((x) => x.id !== c.id)) }
                ])
              }
            >
              <span className={`status-dot ${isUp ? 'running' : 'idle'}`} title={isUp ? 'Connected' : 'Not connected'} />
              <div className="rt-main">
                <div className="rt-name">{c.name}</div>
                <div className="rt-cmd">
                  {c.username ? `${c.username}@` : ''}{c.host}{c.port !== 22 ? `:${c.port}` : ''}
                  {c.jumpId ? ` via ${connections.find((j) => j.id === c.jumpId)?.name ?? 'jump'}` : ''}
                </div>
              </div>
              <div className="row-actions">
                <button className="icon-btn" title="Browse files" onClick={() => setBrowsing(browsing === c.id ? null : c.id)}>
                  <FolderTree size={13} />
                </button>
                <button className="icon-btn go" title="Open terminal" onClick={() => openSshTerminal(c)}>
                  <SquareTerminal size={13} />
                </button>
              </div>
            </div>
            {c.forwards.length > 0 && <Forwards conn={c} />}
            {browsing === c.id && <RemoteTree conn={c} />}
          </div>
        )
      })}
      {!connections.length && <div className="muted-note">Save SSH hosts here and open remote terminals in the dock. Credentials are stored encrypted with your OS keychain and can be shared between connections.</div>}
    </div>
  )
}

function Forwards({ conn }: { conn: SshConnection }): React.JSX.Element {
  const active = useStore(remote, (r) => r.forwards)
  const [error, setError] = useState('')
  return (
    <div className="forwards">
      {conn.forwards.map((f) => {
        const on = active.includes(`${conn.id}/${f.id}`)
        return (
          <div key={f.id} className="forward-row">
            <ArrowRightLeft size={12} />
            <span className="mono small">localhost:{f.localPort} → {f.remoteHost}:{f.remotePort}</span>
            <span className="spacer" />
            <button
              className={`btn xs${on ? ' primary' : ''}`}
              onClick={() =>
                void (on ? window.api.ssh.stopForward(conn.id, f.id) : window.api.ssh.startForward(conn.id, f))
                  .then(() => setError(''), (e) => setError(errText(e)))
                  .then(refreshRemoteState)
              }
            >
              {on ? <><Plug size={11} /> On</> : 'Start'}
            </button>
          </div>
        )
      })}
      {error && <div className="form-error">{error}</div>}
    </div>
  )
}

function RemoteTree({ conn }: { conn: SshConnection }): React.JSX.Element {
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [children, setChildren] = useState<Record<string, RemoteEntry[]>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async (p: string): Promise<void> => {
    try {
      const list = await window.api.ssh.list(conn.id, p)
      setChildren((c) => ({ ...c, [p]: list }))
    } catch (e) {
      setError(errText(e))
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const home = conn.remoteDir || (await window.api.ssh.home(conn.id))
        setRootPath(home)
        await load(home)
        void refreshRemoteState()
      } catch (e) {
        setError(errText(e))
      }
    })()
  }, [conn.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const download = (p: string): void => void window.api.ssh.download(conn.id, p).then((local) => setNotice(`Saved to ${local}`), (e) => setError(errText(e)))

  const render = (p: string, depth: number): React.ReactNode =>
    (children[p] ?? []).map((e) => (
      <div key={e.path}>
        <div
          className="tree-row"
          style={{ paddingLeft: 14 + depth * 12 }}
          onClick={() => {
            if (!e.isDir) return
            const n = new Set(open)
            if (n.has(e.path)) n.delete(e.path)
            else {
              n.add(e.path)
              void load(e.path)
            }
            setOpen(n)
          }}
          onDoubleClick={() => !e.isDir && download(e.path)}
          onContextMenu={(ev) =>
            showContextMenu(ev, [
              { label: 'Open terminal here', icon: <SquareTerminal size={13} />, run: () => openSshTerminal(conn, e.isDir ? e.path : p) },
              ...(e.isDir ? [] : [{ label: 'Download', icon: <Download size={13} />, run: () => download(e.path) }]),
              { label: 'Copy path', icon: <Copy size={13} />, run: () => void navigator.clipboard.writeText(e.path) }
            ])
          }
          title={e.isDir ? e.path : `${e.path} · ${formatSize(e.size)} · double-click to download`}
        >
          <span className={`tree-chevron${open.has(e.path) ? ' open' : ''}`}>{e.isDir && <ChevronRight size={14} />}</span>
          <span className="tree-icon">{e.isDir ? <Folder size={14} className="ic-folder" /> : <File size={14} className="ic-file" />}</span>
          <span className={`tree-name${e.name.startsWith('.') ? ' dimtext' : ''}`}>{e.name}</span>
        </div>
        {e.isDir && open.has(e.path) && render(e.path, depth + 1)}
      </div>
    ))

  return (
    <div className="remote-tree">
      {rootPath && <div className="muted-note mono small">{rootPath}</div>}
      {error && <div className="form-error pad">{error}</div>}
      {notice && <div className="muted-note">{notice}</div>}
      {rootPath ? render(rootPath, 0) : !error && <div className="muted-note">Connecting…</div>}
    </div>
  )
}

function formatSize(n: number): string {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`
}

function ConnectionForm({ initial, onSave, onCancel, onNeedCredential }: { initial: SshConnection; onSave: (c: SshConnection) => void; onCancel: () => void; onNeedCredential: () => void }): React.JSX.Element {
  const [c, setC] = useState(initial)
  const credentials = useStore(remote, (r) => r.credentials)
  const connections = useStore(remote, (r) => r.connections)
  const set = (p: Partial<SshConnection>): void => setC((x) => ({ ...x, ...p }))
  const setFwd = (id: string, p: Partial<PortForward>): void => set({ forwards: c.forwards.map((f) => (f.id === id ? { ...f, ...p } : f)) })
  const valid = c.host.trim() && (c.auth !== 'credential' || c.credentialId)
  return (
    <form
      className="form view-scroll"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSave({ ...c, name: c.name.trim() || c.host.trim(), host: c.host.trim(), username: c.username?.trim() || undefined, forwards: c.forwards.filter((f) => f.localPort && f.remotePort) })
      }}
    >
      <label className="field">
        <span>Name</span>
        <input autoFocus value={c.name} placeholder="prod-api" onChange={(e) => set({ name: e.target.value })} />
      </label>
      <div className="field-row">
        <label className="field" style={{ flex: 3 }}>
          <span>Host</span>
          <input className="mono" value={c.host} placeholder="203.0.113.10" onChange={(e) => set({ host: e.target.value })} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>Port</span>
          <input className="mono" type="number" value={c.port} onChange={(e) => set({ port: Number(e.target.value) || 22 })} />
        </label>
      </div>
      <label className="field">
        <span>Username</span>
        <input className="mono" value={c.username ?? ''} placeholder={c.auth === 'credential' ? '(from credential)' : 'ubuntu'} onChange={(e) => set({ username: e.target.value })} />
      </label>
      <label className="field">
        <span>Authentication</span>
        <select value={c.auth} onChange={(e) => set({ auth: e.target.value as SshConnection['auth'] })}>
          <option value="agent">ssh-agent / Pageant</option>
          <option value="credential">Saved credential</option>
          <option value="prompt">Ask for password each time</option>
        </select>
      </label>
      {c.auth === 'credential' && (
        <label className="field">
          <span>Credential</span>
          <select value={c.credentialId ?? ''} onChange={(e) => set({ credentialId: e.target.value || undefined })}>
            <option value="">Choose…</option>
            {credentials.map((cr) => <option key={cr.id} value={cr.id}>{cr.name} ({cr.kind}{cr.username ? `, ${cr.username}` : ''})</option>)}
          </select>
          {!credentials.length && <a className="hint link" onClick={onNeedCredential}>No credentials yet. Create one first</a>}
        </label>
      )}
      <label className="field">
        <span>Jump host</span>
        <select value={c.jumpId ?? ''} onChange={(e) => set({ jumpId: e.target.value || undefined })}>
          <option value="">None (direct)</option>
          {connections.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Start in folder</span>
        <input className="mono" value={c.remoteDir ?? ''} placeholder="(home)" onChange={(e) => set({ remoteDir: e.target.value || undefined })} />
      </label>
      <div className="field">
        <span>Port forwards (local → remote)</span>
        {c.forwards.map((f) => (
          <div key={f.id} className="field-row fwd-edit">
            <input className="mono" type="number" placeholder="8080" value={f.localPort || ''} onChange={(e) => setFwd(f.id, { localPort: Number(e.target.value) })} />
            <input className="mono" placeholder="localhost" value={f.remoteHost} onChange={(e) => setFwd(f.id, { remoteHost: e.target.value })} />
            <input className="mono" type="number" placeholder="80" value={f.remotePort || ''} onChange={(e) => setFwd(f.id, { remotePort: Number(e.target.value) })} />
            <button type="button" className="icon-btn" onClick={() => set({ forwards: c.forwards.filter((x) => x.id !== f.id) })}><Trash2 size={12} /></button>
          </div>
        ))}
        <button type="button" className="btn xs" onClick={() => set({ forwards: [...c.forwards, { id: newId('fwd'), localPort: 0, remoteHost: 'localhost', remotePort: 0 }] })}>
          <Plus size={11} /> Add forward
        </button>
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!valid}>Save</button>
      </div>
    </form>
  )
}

// ── credentials ──────────────────────────────────────────────────

function Credentials(): React.JSX.Element {
  const credentials = useStore(remote, (r) => r.credentials)
  const connections = useStore(remote, (r) => r.connections)
  const [editing, setEditing] = useState<{ meta?: CredentialMeta } | null>(null)
  if (editing) return <CredentialForm meta={editing.meta} onDone={() => (setEditing(null), void reloadCredentials())} />
  return (
    <div className="view-scroll">
      <div className="view-footer row">
        <button className="btn sm primary" onClick={() => setEditing({})}><Plus size={13} /> New credential</button>
      </div>
      {credentials.map((c) => {
        const users = connections.filter((x) => x.credentialId === c.id).length
        return (
          <div key={c.id} className="rt-row" onDoubleClick={() => setEditing({ meta: c })} onContextMenu={(e) => showContextMenu(e, [
            { label: 'Edit', icon: <Pencil size={13} />, run: () => setEditing({ meta: c }) },
            { label: users ? `Delete (used by ${users})` : 'Delete', icon: <Trash2 size={13} />, run: () => void window.api.vault.remove(c.id).then(reloadCredentials) }
          ])}>
            <span className="task-kind"><KeyRound size={14} /></span>
            <div className="rt-main">
              <div className="rt-name">{c.name}</div>
              <div className="rt-meta">
                {c.kind === 'password' ? 'password' : c.kind === 'key' ? 'private key' : `key file ${c.keyPath}`}
                {c.username ? ` · ${c.username}` : ''}{c.hasPassphrase ? ' · passphrase' : ''} · used by {users}
              </div>
            </div>
            <div className="row-actions">
              <button className="icon-btn" title="Edit" onClick={() => setEditing({ meta: c })}><Pencil size={13} /></button>
            </div>
          </div>
        )
      })}
      {!credentials.length && <div className="muted-note">A credential is a username plus a password, a pasted private key, or a key file (with optional passphrase). Several connections can use the same one.</div>}
    </div>
  )
}

function CredentialForm({ meta, onDone }: { meta?: CredentialMeta; onDone: () => void }): React.JSX.Element {
  const [name, setName] = useState(meta?.name ?? '')
  const [kind, setKind] = useState<CredentialKind>(meta?.kind ?? 'password')
  const [username, setUsername] = useState(meta?.username ?? '')
  const [keyPath, setKeyPath] = useState(meta?.keyPath ?? '~/.ssh/id_ed25519')
  const [secret, setSecret] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState('')
  const keep = (has?: boolean): string => (has ? '•••••• stored. Leave empty to keep' : '')
  const save = async (): Promise<void> => {
    const input: CredentialInput = {
      id: meta?.id,
      name,
      kind,
      username,
      keyPath: kind === 'key-file' ? keyPath : undefined,
      secret: secret || (meta && meta.kind === kind ? undefined : ''),
      passphrase: passphrase || (meta && meta.kind === kind ? undefined : '')
    }
    try {
      await window.api.vault.save(input)
      onDone()
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <form className="form view-scroll" onSubmit={(e) => (e.preventDefault(), void save())}>
      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} placeholder="deploy key" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="seg">
        <button type="button" className={kind === 'password' ? 'on' : ''} onClick={() => setKind('password')}>Password</button>
        <button type="button" className={kind === 'key' ? 'on' : ''} onClick={() => setKind('key')}>Private key</button>
        <button type="button" className={kind === 'key-file' ? 'on' : ''} onClick={() => setKind('key-file')}>Key file</button>
      </div>
      <label className="field">
        <span>Username (optional)</span>
        <input className="mono" value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      {kind === 'password' && (
        <label className="field">
          <span>Password</span>
          <input type="password" value={secret} placeholder={keep(meta?.kind === 'password' && meta.hasSecret)} onChange={(e) => setSecret(e.target.value)} />
        </label>
      )}
      {kind === 'key' && (
        <label className="field">
          <span>Private key</span>
          <textarea className="mono" rows={6} value={secret} placeholder={keep(meta?.kind === 'key' && meta.hasSecret) || '-----BEGIN OPENSSH PRIVATE KEY-----'} onChange={(e) => setSecret(e.target.value)} />
        </label>
      )}
      {kind === 'key-file' && (
        <label className="field">
          <span>Key file path</span>
          <input className="mono" value={keyPath} onChange={(e) => setKeyPath(e.target.value)} />
        </label>
      )}
      {kind !== 'password' && (
        <label className="field">
          <span>Passphrase (if the key has one)</span>
          <input type="password" value={passphrase} placeholder={keep(meta?.hasPassphrase)} onChange={(e) => setPassphrase(e.target.value)} />
        </label>
      )}
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!name.trim() || (kind === 'key-file' && !keyPath.trim())}>Save</button>
      </div>
    </form>
  )
}
