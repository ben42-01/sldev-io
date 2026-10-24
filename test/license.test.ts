import { generateKeyPairSync } from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { isLocked, maskKey, trialState } from '@shared/license'
import type { BetaStatus } from '@shared/beta'
import { publicKeyFrom, privateKeyFrom, signLicense, verifyLicense, type LicenseClaims } from '../website/api/_licenseToken'
import { POST as activate } from '../website/api/license/activate'
import { POST as refresh } from '../website/api/license/refresh'
import { POST as deactivate } from '../website/api/license/deactivate'

const pair = generateKeyPairSync('ed25519')
const PRIVATE = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
const PUBLIC = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
const MACHINE = 'a'.repeat(64)
const DAY = 86_400_000

const claims = (over: Partial<LicenseClaims> = {}): LicenseClaims => ({ v: 1, lid: 'lic', aid: 'act', plan: 'personal', machine: MACHINE, email: null, iat: 0, exp: DAY, ...over })

describe('license token', () => {
  it('round-trips and rejects tampering or another key', () => {
    const token = signLicense(claims({ email: 'a@b.c' }), privateKeyFrom(PRIVATE))
    expect(verifyLicense(token, publicKeyFrom(PUBLIC))?.email).toBe('a@b.c')
    const [body, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify(claims({ plan: 'team' }))).toString('base64url')
    expect(verifyLicense(`${forged}.${sig}`, publicKeyFrom(PUBLIC))).toBeNull()
    const other = generateKeyPairSync('ed25519').publicKey
    expect(verifyLicense(token, other)).toBeNull()
    expect(verifyLicense(`${body}`, publicKeyFrom(PUBLIC))).toBeNull()
    expect(verifyLicense('garbage', publicKeyFrom(PUBLIC))).toBeNull()
  })
})

describe('trial and lock', () => {
  const beta = (phase: BetaStatus['phase']): BetaStatus => ({ phase, config: { startsAt: null, endsAt: null }, daysLeft: null, source: 'none', checkedAt: null })
  const base = { licensed: false, plan: null, email: null, maskedKey: null, validUntil: null, trial: null, message: null, available: true }

  it('counts the 14-day trial down', () => {
    expect(trialState(0, 0)).toEqual({ daysLeft: 14, ended: false })
    expect(trialState(0, 10 * DAY)).toEqual({ daysLeft: 4, ended: false })
    expect(trialState(0, 14 * DAY)).toEqual({ daysLeft: 0, ended: true })
  })

  it('locks only an ended beta or trial without a license', () => {
    expect(isLocked(beta('ended'), base)).toBe(true)
    expect(isLocked(beta('ended'), { ...base, licensed: true })).toBe(false)
    expect(isLocked(beta('active'), base)).toBe(false)
    expect(isLocked(beta('off'), { ...base, trial: { daysLeft: 0, ended: true } })).toBe(true)
    expect(isLocked(beta('off'), { ...base, trial: { daysLeft: 3, ended: false } })).toBe(false)
  })

  it('masks keys for display', () => {
    expect(maskKey('SLDEV-1234-5678-ABCD')).toBe('SLDEV-…ABCD')
  })
})

/** A fake Polar sandbox: one key with the given activations and limit. */
function fakePolar({ activations = [] as { id: string; meta: { machine: string } }[], limit = 3, status = 'granted' } = {}) {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    const body = init.body ? JSON.parse(String(init.body)) : {}
    calls.push(path)
    const json = (s: number, d: unknown) => new Response(d === null ? null : JSON.stringify(d), { status: s })
    const key = { id: 'lic-1', benefit_id: 'ben-team', status, limit_activations: limit, customer: { email: 'buyer@example.com' } }
    if (path.endsWith('/license-keys/validate')) {
      if (body.key !== 'GOOD' || status !== 'granted') return json(404, { error: 'ResourceNotFound' })
      if (body.activation_id && !activations.some((a) => a.id === body.activation_id)) return json(404, { error: 'ResourceNotFound' })
      return json(200, key)
    }
    if (path === '/v1/license-keys/lic-1') return json(200, { ...key, activations })
    if (path.endsWith('/license-keys/activate')) {
      if (activations.length >= limit) return json(403, { error: 'NotPermitted' })
      const a = { id: `act-${activations.length + 1}`, meta: body.meta }
      activations.push(a)
      return json(200, { id: a.id })
    }
    if (path.endsWith('/license-keys/deactivate')) return json(204, null)
    if (path.startsWith('/v1/products/')) return json(200, { benefits: [{ id: path.endsWith('b5bbfcf4-58b3-466a-bc4c-25524d343cc1') ? 'ben-team' : 'ben-personal', type: 'license_keys' }] })
    return json(404, null)
  })
  return { calls, activations }
}

const post = (fn: (r: Request) => Promise<Response>, body: unknown) => fn(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }))

describe('license server', () => {
  beforeAll(() => {
    process.env.LICENSE_SIGNING_KEY = PRIVATE
    process.env.POLAR_ACCESS_TOKEN = 'test-token'
  })
  afterEach(() => vi.unstubAllGlobals())

  it('activates a key and signs a token for this machine with the right plan', async () => {
    fakePolar()
    const res = await post(activate, { key: 'GOOD', machine: MACHINE, label: 'Linux x64', version: '1.0.0' })
    expect(res.status).toBe(200)
    const c = verifyLicense(((await res.json()) as { token: string }).token, publicKeyFrom(PUBLIC))
    expect(c).toMatchObject({ lid: 'lic-1', aid: 'act-1', plan: 'team', machine: MACHINE, email: 'buyer@example.com' })
    expect(c!.exp - c!.iat).toBe(45 * DAY)
  })

  it('reuses the activation when the same machine activates again', async () => {
    const polar = fakePolar({ activations: [{ id: 'act-9', meta: { machine: MACHINE } }] })
    const res = await post(activate, { key: 'GOOD', machine: MACHINE })
    const c = verifyLicense(((await res.json()) as { token: string }).token, publicKeyFrom(PUBLIC))
    expect(c?.aid).toBe('act-9')
    expect(polar.activations).toHaveLength(1)
  })

  it('explains invalid keys and full activation limits', async () => {
    fakePolar()
    const bad = await post(activate, { key: 'NOPE', machine: MACHINE })
    expect(bad.status).toBe(403)
    expect(((await bad.json()) as { error: string }).error).toMatch(/isn't valid/)
    fakePolar({ activations: [{ id: 'x', meta: { machine: 'b'.repeat(64) } }], limit: 1 })
    const full = await post(activate, { key: 'GOOD', machine: MACHINE })
    expect(full.status).toBe(403)
    expect(((await full.json()) as { error: string }).error).toMatch(/maximum number of machines/)
    expect((await post(activate, { key: 'GOOD', machine: 'not-a-hash' })).status).toBe(400)
  })

  it('refreshes a live activation and refuses a removed one', async () => {
    const token = signLicense(claims({ lid: 'lic-1', aid: 'act-1', iat: 1, exp: 2 }), privateKeyFrom(PRIVATE))
    fakePolar({ activations: [{ id: 'act-1', meta: { machine: MACHINE } }] })
    const ok = await post(refresh, { token, key: 'GOOD' })
    expect(ok.status).toBe(200)
    const c = verifyLicense(((await ok.json()) as { token: string }).token, publicKeyFrom(PUBLIC))
    expect(c!.exp).toBeGreaterThan(Date.now())
    fakePolar({ activations: [] })
    expect((await post(refresh, { token, key: 'GOOD' })).status).toBe(403)
    // a token signed by someone else is rejected before Polar is asked
    const forged = signLicense(claims(), generateKeyPairSync('ed25519').privateKey)
    expect((await post(refresh, { token: forged, key: 'GOOD' })).status).toBe(400)
  })

  it('deactivates this machine', async () => {
    const polar = fakePolar({ activations: [{ id: 'act-1', meta: { machine: MACHINE } }] })
    const token = signLicense(claims({ aid: 'act-1' }), privateKeyFrom(PRIVATE))
    expect((await post(deactivate, { token, key: 'GOOD' })).status).toBe(200)
    expect(polar.calls).toContain('/v1/customer-portal/license-keys/deactivate')
  })

  it('reports a server without a signing key as not configured', async () => {
    const saved = process.env.LICENSE_SIGNING_KEY
    delete process.env.LICENSE_SIGNING_KEY
    fakePolar()
    const res = await post(activate, { key: 'GOOD', machine: MACHINE })
    process.env.LICENSE_SIGNING_KEY = saved
    expect(res.status).toBe(503)
  })
})
