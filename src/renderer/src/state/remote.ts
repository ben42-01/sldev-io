import { posixQuote } from '@shared/argv'
import type { CredentialMeta, SshConnection } from '@shared/types'
import { openTerminal } from '../dock/dockApi'
import { createStore } from './store'

export const remote = createStore<{ connections: SshConnection[]; credentials: CredentialMeta[]; connected: string[]; forwards: string[]; loaded: boolean }>({
  connections: [],
  credentials: [],
  connected: [],
  forwards: [],
  loaded: false
})

export async function loadRemote(): Promise<void> {
  const [store, credentials] = await Promise.all([window.api.store.get('connections'), window.api.vault.list()])
  remote.set({ connections: store?.connections ?? [], credentials, loaded: true })
  await refreshRemoteState()
}

export async function refreshRemoteState(): Promise<void> {
  const [connected, forwards] = await Promise.all([window.api.ssh.connected(), window.api.ssh.forwards()])
  remote.set({ connected, forwards })
}

export async function saveConnections(connections: SshConnection[]): Promise<void> {
  remote.set({ connections })
  await window.api.store.set('connections', { connections })
}

export async function reloadCredentials(): Promise<void> {
  remote.set({ credentials: await window.api.vault.list() })
}

export function openSshTerminal(c: SshConnection, dir?: string): void {
  openTerminal({ title: c.name, sshConnectionId: c.id, initialInput: dir ? `cd ${posixQuote(dir)}\r` : undefined })
  setTimeout(() => void refreshRemoteState(), 3000)
}

export const newId = (p: string): string => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
