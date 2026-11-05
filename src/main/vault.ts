import { app, safeStorage } from 'electron'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import type { CredentialInput, CredentialMeta, VaultStatus } from '@shared/types'
import { JsonStore } from './store'

/**
 * Reusable SSH credentials. Secrets are encrypted with the OS keychain via Electron safeStorage
 * (Keychain / DPAPI / libsecret) and never leave the main process; the UI only sees metadata.
 */

interface Stored {
  id: string
  name: string
  kind: CredentialInput['kind']
  username?: string
  keyPath?: string
  secret?: string
  passphrase?: string
}

let store: JsonStore<{ credentials: Stored[] }>

export function initVault(): void {
  store = new JsonStore(app.getPath('userData'), 'credentials', { credentials: [] })
}

export function flushVault(): void {
  store?.flush()
}

export async function vaultStatus(): Promise<VaultStatus> {
  const encrypted = await safeStorage.isAsyncEncryptionAvailable()
  const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : process.platform === 'darwin' ? 'keychain' : 'dpapi'
  return { encrypted: encrypted && backend !== 'basic_text', backend }
}

async function enc(s: string): Promise<string> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('No OS keychain available to encrypt credentials')
  return (await safeStorage.encryptStringAsync(s)).toString('base64')
}

/** Decrypt; when the OS rotated the key, re-encrypt and store via `reencrypt`. */
async function dec(s: string, reencrypt: (fresh: string) => void): Promise<string> {
  const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(s, 'base64'))
  if (shouldReEncrypt) void enc(result).then(reencrypt, () => {})
  return result
}

const meta = (c: Stored): CredentialMeta => ({
  id: c.id,
  name: c.name,
  kind: c.kind,
  username: c.username,
  keyPath: c.keyPath,
  hasSecret: !!c.secret,
  hasPassphrase: !!c.passphrase
})

export function listCredentials(): CredentialMeta[] {
  return store.get().credentials.map(meta)
}

export async function saveCredential(input: CredentialInput): Promise<CredentialMeta> {
  const list = store.get().credentials
  const prev = input.id ? list.find((c) => c.id === input.id) : undefined
  const next: Stored = {
    id: prev?.id ?? `cred-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: input.name.trim() || 'Credential',
    kind: input.kind,
    username: input.username?.trim() || undefined,
    keyPath: input.kind === 'key-file' ? input.keyPath?.trim() : undefined,
    secret: input.kind === 'key-file' ? undefined : input.secret !== undefined ? (input.secret ? await enc(input.secret) : undefined) : prev?.secret,
    passphrase: input.kind === 'password' ? undefined : input.passphrase !== undefined ? (input.passphrase ? await enc(input.passphrase) : undefined) : prev?.passphrase
  }
  const list2 = store.get().credentials // re-read: encryption awaited
  store.set({ credentials: list2.some((c) => c.id === next.id) ? list2.map((c) => (c.id === next.id ? next : c)) : [...list2, next] })
  return meta(next)
}

export function deleteCredential(id: string): void {
  store.set({ credentials: store.get().credentials.filter((c) => c.id !== id) })
}

export interface ResolvedAuth {
  username?: string
  password?: string
  privateKey?: string | Buffer
  passphrase?: string
}

export async function resolveCredential(id: string): Promise<ResolvedAuth> {
  const c = store.get().credentials.find((x) => x.id === id)
  if (!c) throw new Error('Credential not found. It may have been deleted')
  const patch = (field: 'secret' | 'passphrase') => (fresh: string) =>
    store.set({ credentials: store.get().credentials.map((x) => (x.id === id ? { ...x, [field]: fresh } : x)) })
  const out: ResolvedAuth = { username: c.username }
  if (c.kind === 'password' && c.secret) out.password = await dec(c.secret, patch('secret'))
  if (c.kind === 'key' && c.secret) out.privateKey = await dec(c.secret, patch('secret'))
  if (c.kind === 'key-file' && c.keyPath) out.privateKey = readFileSync(c.keyPath.replace(/^~(?=$|[\\/])/, homedir()))
  if (c.passphrase) out.passphrase = await dec(c.passphrase, patch('passphrase'))
  return out
}

/** Find or create a key-file credential (used when importing ~/.ssh/config). */
export async function ensureKeyFileCredential(keyPath: string, username?: string): Promise<string> {
  const existing = store.get().credentials.find((c) => c.kind === 'key-file' && c.keyPath === keyPath && c.username === username)
  if (existing) return existing.id
  return (await saveCredential({ name: `key ${keyPath.split(/[\\/]/).pop()}${username ? ` (${username})` : ''}`, kind: 'key-file', keyPath, username })).id
}
