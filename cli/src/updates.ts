import { readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { VERSION } from './version'

/**
 * The update check: once a day at most, the TUI asks the npm registry for sldev-cli's `latest` version. It's
 * the CLI's one network request of its own besides `gh` (on /privacy), sends nothing but the package name, and
 * is off with `"updateCheck": false` in config.json, `SLDEV_NO_UPDATE_CHECK=1`, or in CI. The answer is kept
 * in `<data>/update.json` with the version last told about, so each new version gets its message once.
 */

export const PACKAGE = 'sldev-cli'
export const INSTALL_COMMAND = `npm install -g ${PACKAGE}@latest`
const REGISTRY = `https://registry.npmjs.org/${PACKAGE}/latest`
const DAY_MS = 24 * 60 * 60 * 1000
const TIMEOUT_MS = 3000

interface UpdateState {
  /** when the registry was last asked (ms) */
  checkedAt: number
  /** what it said `latest` was */
  latest: string | null
  /** the version the message line last told about */
  shown: string | null
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

/** -1, 0 or 1 as `a` is older, equal or newer than `b`; a prerelease is older than its release. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [SEMVER.exec(a), SEMVER.exec(b)]
  if (!x || !y) return 0
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i])
    if (d) return Math.sign(d)
  }
  if (x[4] === y[4]) return 0
  if (!x[4]) return 1
  if (!y[4]) return -1
  return x[4] < y[4] ? -1 : 1
}

export const isNewer = (latest: string | null | undefined, current = VERSION): latest is string => !!latest && SEMVER.test(latest) && compareVersions(latest, current) > 0

export const updateCheckOff = (env: NodeJS.ProcessEnv, configOn: boolean): boolean => !configOn || !!env.SLDEV_NO_UPDATE_CHECK || !!env.CI

const statePath = (dataDir: string): string => join(dataDir, 'update.json')

function readState(dataDir: string): UpdateState {
  try {
    const raw = JSON.parse(readFileSync(statePath(dataDir), 'utf8')) as Partial<UpdateState>
    return {
      checkedAt: typeof raw.checkedAt === 'number' ? raw.checkedAt : 0,
      latest: typeof raw.latest === 'string' ? raw.latest : null,
      shown: typeof raw.shown === 'string' ? raw.shown : null
    }
  } catch {
    return { checkedAt: 0, latest: null, shown: null }
  }
}

function writeState(dataDir: string, s: UpdateState): void {
  try {
    const file = statePath(dataDir)
    writeFileSync(file + '.tmp', JSON.stringify(s))
    renameSync(file + '.tmp', file)
  } catch {
    // not remembered: asked again next time, which is harmless
  }
}

/** The registry's `latest` for sldev-cli, or null on any failure (offline, slow, a proxy): never an error. */
export async function fetchLatest(fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchFn(REGISTRY, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    const v = ((await res.json()) as { version?: unknown }).version
    return typeof v === 'string' && SEMVER.test(v) ? v : null
  } catch {
    return null
  }
}

/**
 * A newer version than this one, or null: the registry is asked only when the last answer is a day old.
 * `first`: not told about yet, so the TUI says so on the message line once; its sidebar shows it every time.
 */
export async function updateToAnnounce(dataDir: string, opts: { now?: number; fetchLatest?: () => Promise<string | null>; current?: string } = {}): Promise<{ version: string; first: boolean } | null> {
  const now = opts.now ?? Date.now()
  const state = readState(dataDir)
  if (now - state.checkedAt >= DAY_MS || now < state.checkedAt) {
    const latest = await (opts.fetchLatest ?? fetchLatest)()
    // a failed ask still waits a day, so an offline machine doesn't try on every attach
    state.checkedAt = now
    if (latest) state.latest = latest
    writeState(dataDir, state)
  }
  if (!isNewer(state.latest, opts.current ?? VERSION)) return null
  return { version: state.latest, first: state.shown !== state.latest }
}

/** The message line told about `version`: it isn't told again (the sidebar row stays). */
export function markAnnounced(dataDir: string, version: string): void {
  writeState(dataDir, { ...readState(dataDir), shown: version })
}
