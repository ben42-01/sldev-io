import { app, safeStorage } from 'electron'
import { promises as fsp } from 'fs'
import { arch, type as osType } from 'os'
import { join } from 'path'
import { maskKey, trialState, type LicenseStatus } from '@shared/license'
import { publicKeyFrom, REFRESH_AFTER_MS, verifyLicense, type LicenseClaims } from '../../website/api/_licenseToken'
import { LICENSE_PUBLIC_KEY } from './licenseKey'
import { machineHash } from './machineId'

declare const __SITE_URL__: string

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000

interface State {
  key: string | null
  token: string | null
  /** stable builds: first start, for the trial */
  trialStartedAt: number | null
  /** latest wall-clock time seen: turning the clock back doesn't extend a trial or a token */
  lastSeen: number
  message: string | null
}

let state: State | null = null
let notify: (s: LicenseStatus) => void = () => undefined

const isBetaBuild = (): boolean => /-beta\b/.test(app.getVersion())
const stateFile = (): string => join(app.getPath('userData'), 'license.bin')
// test and staging overrides; packaged builds always use the built-in key and site
const dev = (name: string): string | undefined => (app.isPackaged ? undefined : process.env[name])
const apiBase = (): string => dev('SLDEV_LICENSE_API') || `${__SITE_URL__}/api/license`
const publicKeyB64 = (): string => dev('SLDEV_LICENSE_PUBLIC_KEY') || LICENSE_PUBLIC_KEY

async function load(): Promise<State> {
  if (state) return state
  let s: State = { key: null, token: null, trialStartedAt: null, lastSeen: 0, message: null }
  try {
    const buf = await fsp.readFile(stateFile())
    const text = (await safeStorage.isAsyncEncryptionAvailable()) ? (await safeStorage.decryptStringAsync(buf)).result : buf.toString('utf8')
    s = { ...s, ...(JSON.parse(text) as Partial<State>) }
  } catch {
    // first start, or an unreadable file: start clean
  }
  if (!isBetaBuild()) s.trialStartedAt ??= Date.now()
  // e2e: pretend the trial started this many days ago
  const daysAgo = Number(dev('SLDEV_TRIAL_DAYS_AGO'))
  if (daysAgo) s.trialStartedAt = Date.now() - daysAgo * 86_400_000
  state = s
  await save({})
  return s
}

// Encrypted like the beta cache: not tamper-proof, but the token's signature is what counts.
async function save(patch: Partial<State>): Promise<void> {
  state = { ...state!, ...patch, lastSeen: Math.max(Date.now(), state?.lastSeen ?? 0) }
  const text = JSON.stringify(state)
  const data = (await safeStorage.isAsyncEncryptionAvailable()) ? await safeStorage.encryptStringAsync(text) : Buffer.from(text)
  await fsp.writeFile(stateFile(), data).catch(() => undefined)
}

const now = (): number => Math.max(Date.now(), state?.lastSeen ?? 0)

/** The token's claims when it's signed by us and issued to this machine. */
async function claims(): Promise<LicenseClaims | null> {
  const b64 = publicKeyB64()
  if (!state?.token || !b64) return null
  const c = verifyLicense(state.token, publicKeyFrom(b64))
  return c && c.machine === (await machineHash()) ? c : null
}

export async function licenseStatus(): Promise<LicenseStatus> {
  const s = await load()
  const c = await claims()
  const licensed = !!c && c.exp > now()
  return {
    licensed,
    plan: c?.plan ?? null,
    email: c?.email ?? null,
    maskedKey: s.key ? maskKey(s.key) : null,
    validUntil: c?.exp ?? null,
    trial: !licensed && s.trialStartedAt !== null ? trialState(s.trialStartedAt, now()) : null,
    message: c && !licensed ? "sldev-io couldn't confirm your license for a while. Connect to the internet and choose Check license." : s.message,
    available: !!publicKeyB64()
  }
}

class ServerError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${apiBase()}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
  } catch {
    throw new Error("Couldn't reach the license server. Check your internet connection.")
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new ServerError(res.status, data.error || `License server error (${res.status})`)
  return data
}

export async function activateLicense(rawKey: string): Promise<LicenseStatus> {
  await load()
  const key = rawKey.trim()
  if (!key) throw new Error('Enter your license key.')
  if (!publicKeyB64()) throw new Error("This build of sldev-io can't activate licenses yet.")
  const machine = await machineHash()
  const { token } = await post<{ token: string }>('activate', { key, machine, label: `${osType()} ${arch()}`, version: app.getVersion() })
  const c = verifyLicense(token, publicKeyFrom(publicKeyB64()))
  if (!c || c.machine !== machine) throw new Error('The license server sent an invalid license. Try again later.')
  await save({ key, token, message: null })
  return changed()
}

/** Frees this machine's slot so the license can be used on another one. */
export async function deactivateLicense(): Promise<LicenseStatus> {
  const s = await load()
  if (s.token && s.key) await post('deactivate', { token: s.token, key: s.key })
  await save({ key: null, token: null, message: null })
  return changed()
}

/** Renew the token every couple of weeks; a revoked or refunded key loses it here. */
export async function refreshLicense(force = false): Promise<LicenseStatus> {
  const s = await load()
  const c = await claims()
  if (!c || !s.key || (!force && now() - c.iat < REFRESH_AFTER_MS)) return licenseStatus()
  try {
    const { token } = await post<{ token: string }>('refresh', { token: s.token, key: s.key })
    if (verifyLicense(token, publicKeyFrom(publicKeyB64()))?.machine === c.machine) await save({ token, message: null })
  } catch (err) {
    // offline or server trouble: keep the token until it expires
    if (err instanceof ServerError && err.status === 403) await save({ token: null, message: `${err.message} Enter a license key to keep using sldev-io.` })
    else if (force) throw err
  }
  return changed()
}

async function changed(): Promise<LicenseStatus> {
  const s = await licenseStatus()
  notify(s)
  return s
}

export function startLicenseChecks(onChange: (s: LicenseStatus) => void): void {
  notify = onChange
  void refreshLicense().catch(() => undefined)
  setInterval(() => void refreshLicense().catch(() => undefined), CHECK_EVERY_MS).unref()
}
