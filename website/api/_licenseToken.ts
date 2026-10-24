/**
 * The signed license token the license server issues and the desktop app checks offline.
 * Shared by website/api/license/* (signs) and src/main/license.ts (verifies), so the format lives
 * in one place. Files starting with "_" in api/ are not deployed as functions.
 *
 * Format: base64url(JSON claims) "." base64url(Ed25519 signature of the first part).
 */
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'

export type LicensePlan = 'personal' | 'team'

export interface LicenseClaims {
  v: 1
  /** Polar license key id */
  lid: string
  /** Polar activation id: one per machine */
  aid: string
  plan: LicensePlan
  /** SHA-256 machine hash the activation belongs to; a copied token fails on another machine */
  machine: string
  /** shown in Settings → License */
  email: string | null
  /** issued at, ms */
  iat: number
  /** works offline until, ms */
  exp: number
}

const DAY = 86_400_000
/** the app refreshes a token this old */
export const REFRESH_AFTER_MS = 14 * DAY
/** and keeps working offline this long after the last successful refresh */
export const TOKEN_TTL_MS = 45 * DAY

/** Private key: base64 PKCS#8 DER (LICENSE_SIGNING_KEY). Public key: base64 SPKI DER. */
export const privateKeyFrom = (b64: string): KeyObject => createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' })
export const publicKeyFrom = (b64: string): KeyObject => createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' })

export function signLicense(claims: LicenseClaims, privateKey: KeyObject): string {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${body}.${sign(null, Buffer.from(body), privateKey).toString('base64url')}`
}

/** The claims if the signature is valid, else null. Expiry and machine are the caller's to check. */
export function verifyLicense(token: string, publicKey: KeyObject): LicenseClaims | null {
  const [body, sig, extra] = token.split('.')
  if (!body || !sig || extra !== undefined) return null
  try {
    if (!verify(null, Buffer.from(body), publicKey, Buffer.from(sig, 'base64url'))) return null
    const c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LicenseClaims
    const ok = c.v === 1 && typeof c.lid === 'string' && typeof c.aid === 'string' && typeof c.machine === 'string'
    return ok && (c.plan === 'personal' || c.plan === 'team') && Number.isFinite(c.iat) && Number.isFinite(c.exp) ? c : null
  } catch {
    return null
  }
}
