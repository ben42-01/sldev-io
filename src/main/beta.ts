import { app, safeStorage } from 'electron'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { betaPhase, parseBetaConfig, type BetaConfig, type BetaStatus } from '@shared/beta'

declare const __BETA_CONFIG_URL__: string

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 5000
/** startup doesn't wait longer than this for the network; it uses the cached dates instead */
const STARTUP_WAIT_MS = 1500

interface Cache {
  config: BetaConfig
  checkedAt: number
  /** latest wall-clock time ever seen: turning the clock back doesn't reopen an ended beta */
  lastSeen: number
}

let cache: Cache | null = null
let status: BetaStatus | null = null
let first: Promise<BetaStatus> | null = null

const isBetaBuild = (): boolean => /-beta\b/.test(app.getVersion())
/** env override for tests and staging */
const configUrl = (): string => process.env.SLDEV_BETA_CONFIG_URL || __BETA_CONFIG_URL__
const cacheFile = (): string => join(app.getPath('userData'), 'beta-state.bin')

// Encrypted so the dates can't be edited in a text editor. Not tamper-proof, just not trivial.
async function readCache(): Promise<Cache | null> {
  try {
    const buf = await fsp.readFile(cacheFile())
    const text = (await safeStorage.isAsyncEncryptionAvailable()) ? (await safeStorage.decryptStringAsync(buf)).result : buf.toString('utf8')
    const c = JSON.parse(text) as Cache
    return { config: parseBetaConfig(c.config), checkedAt: Number(c.checkedAt) || 0, lastSeen: Number(c.lastSeen) || 0 }
  } catch {
    return null
  }
}

async function writeCache(c: Cache): Promise<void> {
  const text = JSON.stringify(c)
  const data = (await safeStorage.isAsyncEncryptionAvailable()) ? await safeStorage.encryptStringAsync(text) : Buffer.from(text)
  await fsp.writeFile(cacheFile(), data).catch(() => undefined)
}

async function fetchConfig(): Promise<{ config: BetaConfig; serverNow: number } | null> {
  try {
    const res = await fetch(configUrl(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' })
    if (!res.ok) return null
    const serverNow = Date.parse(res.headers.get('date') ?? '') || 0
    return { config: parseBetaConfig(await res.json()), serverNow }
  } catch {
    return null
  }
}

async function check(): Promise<BetaStatus> {
  cache ??= await readCache()
  const remote = isBetaBuild() ? await fetchConfig() : null
  const lastSeen = Math.max(Date.now(), cache?.lastSeen ?? 0, remote?.serverNow ?? 0)
  if (remote) cache = { config: remote.config, checkedAt: Date.now(), lastSeen }
  else if (cache) cache = { ...cache, lastSeen }
  if (cache) void writeCache(cache)
  status = fromCache(remote ? 'remote' : undefined)
  return status
}

function fromCache(source?: BetaStatus['source']): BetaStatus {
  const config = cache?.config ?? { startsAt: null, endsAt: null }
  return {
    ...betaPhase(config, Math.max(Date.now(), cache?.lastSeen ?? 0), isBetaBuild()),
    config,
    source: source ?? (cache ? 'cache' : 'none'),
    checkedAt: cache?.checkedAt ?? null
  }
}

/** Start checking: once now, then every few hours. `onChange` gets every fresh status. */
export function startBetaChecks(onChange: (s: BetaStatus) => void): void {
  first = check()
  void first.then(onChange)
  setInterval(() => void check().then(onChange), CHECK_EVERY_MS).unref()
}

export async function betaStatus(): Promise<BetaStatus> {
  if (status) return status
  const pending = first ?? check()
  const slow = new Promise<BetaStatus>((resolve) =>
    setTimeout(async () => {
      cache ??= await readCache()
      resolve(fromCache())
    }, STARTUP_WAIT_MS)
  )
  return Promise.race([pending, slow])
}

export async function refreshBeta(): Promise<BetaStatus> {
  return check()
}
