/**
 * Polar calls for the license server. Production (VERCEL_ENV=production) uses the live
 * organization; previews and local runs use the sandbox. IDs are in docs/go-to-production.md.
 */
import { createPublicKey } from 'node:crypto'
import { privateKeyFrom, type LicensePlan } from './_licenseToken.js'

const live = process.env.VERCEL_ENV === 'production'

export const polar = live
  ? {
      api: 'https://api.polar.sh',
      organizationId: '0a93fdbe-37be-4c87-b67d-bb55bd519a02',
      products: { '7c2938d3-5332-43ec-8cc8-0675d275d6d5': 'personal', 'e6901d0f-06ad-4d3d-9cf0-c75603f6486c': 'team' } as Record<string, LicensePlan>
    }
  : {
      api: 'https://sandbox-api.polar.sh',
      organizationId: '44affab5-d66f-4a87-89dc-e854ffe79dcb',
      products: { '290c2831-7c65-43a0-8645-33f0463daa89': 'personal', 'b5bbfcf4-58b3-466a-bc4c-25524d343cc1': 'team' } as Record<string, LicensePlan>
    }

export class LicenseError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export function keys() {
  const b64 = process.env.LICENSE_SIGNING_KEY
  if (!b64) throw new LicenseError(503, 'Licensing is not configured on the server yet.')
  const privateKey = privateKeyFrom(b64.trim())
  // derived, so only one secret has to be stored
  return { privateKey, publicKey: createPublicKey(privateKey) }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, auth = false): Promise<{ status: number; data: T | null }> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = process.env.POLAR_ACCESS_TOKEN
    if (!token) throw new LicenseError(503, 'Licensing is not configured on the server yet.')
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(`${polar.api}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (res.status >= 500) throw new LicenseError(502, 'The license service is unavailable. Try again in a minute.')
  const text = await res.text()
  return { status: res.status, data: text ? (JSON.parse(text) as T) : null }
}

export interface PolarKey {
  id: string
  benefit_id: string
  status: string
  limit_activations: number | null
  customer?: { email?: string | null } | null
  activation?: { id: string } | null
}
interface PolarActivation {
  id: string
  meta: Record<string, unknown>
}

/** Validates the key (and the activation, if given). Unknown, revoked, disabled and expired keys all come back 404. */
export async function validateKey(key: string, activationId?: string): Promise<PolarKey> {
  const r = await call<PolarKey>('POST', '/v1/customer-portal/license-keys/validate', { key, organization_id: polar.organizationId, ...(activationId ? { activation_id: activationId } : {}) })
  if (r.status === 404) throw new LicenseError(403, activationId ? 'This license is no longer active on this machine.' : "That license key isn't valid. Check it against your receipt email.")
  if (r.status !== 200 || !r.data) throw new LicenseError(400, "That license key isn't valid.")
  return r.data
}

/** This machine's existing activation, so reinstalling doesn't use up another slot. */
export async function findActivation(licenseKeyId: string, machine: string): Promise<string | null> {
  const r = await call<{ activations?: PolarActivation[] }>('GET', `/v1/license-keys/${licenseKeyId}`, undefined, true)
  if (r.status !== 200) throw new LicenseError(502, 'Could not look up the license. Try again in a minute.')
  return r.data?.activations?.find((a) => a.meta?.machine === machine)?.id ?? null
}

export async function activate(key: string, machine: string, label: string, version: string): Promise<string> {
  const r = await call<{ id: string; detail?: string }>('POST', '/v1/customer-portal/license-keys/activate', {
    key,
    organization_id: polar.organizationId,
    label,
    meta: { machine, version }
  })
  if (r.status === 403) throw new LicenseError(403, 'This license is already active on the maximum number of machines. Deactivate it on a machine you no longer use (Settings → License), then try again.')
  if (r.status === 404) throw new LicenseError(403, "That license key isn't valid. Check it against your receipt email.")
  if (r.status !== 200 || !r.data) throw new LicenseError(400, 'Could not activate this license.')
  return r.data.id
}

export async function deactivate(key: string, activationId: string): Promise<void> {
  const r = await call('POST', '/v1/customer-portal/license-keys/deactivate', { key, organization_id: polar.organizationId, activation_id: activationId })
  if (r.status !== 204 && r.status !== 404) throw new LicenseError(400, 'Could not deactivate this machine.')
}

let benefitPlans: Promise<Map<string, LicensePlan>> | null = null

/** Which plan a key belongs to: each product has its own License Keys benefit. */
export async function planFor(k: PolarKey): Promise<LicensePlan> {
  benefitPlans ??= (async () => {
    const map = new Map<string, LicensePlan>()
    for (const [productId, plan] of Object.entries(polar.products)) {
      const r = await call<{ benefits?: { id: string; type: string }[] }>('GET', `/v1/products/${productId}`, undefined, true)
      for (const b of r.data?.benefits ?? []) if (b.type === 'license_keys') map.set(b.id, plan)
    }
    return map
  })().catch((err) => {
    benefitPlans = null
    throw err
  })
  const plans = await benefitPlans.catch(() => new Map<string, LicensePlan>())
  // without products:read on the token, fall back to the activation limit (Team allows 15)
  return plans.get(k.benefit_id) ?? ((k.limit_activations ?? 0) >= 15 ? 'team' : 'personal')
}

/** Read a JSON body and turn errors into `{ error }` responses. */
export async function handle(request: Request, run: (body: Record<string, unknown>) => Promise<unknown>): Promise<Response> {
  const json = (status: number, data: unknown): Response => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') throw new LicenseError(400, 'Bad request.')
    return json(200, await run(body))
  } catch (err) {
    if (err instanceof LicenseError) return json(err.status, { error: err.message })
    console.error('license error:', err)
    return json(500, { error: 'Something went wrong. Try again in a minute.' })
  }
}

export const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
export const isMachine = (v: string): boolean => /^[a-f0-9]{64}$/.test(v)
