/** POST /api/license/activate { key, machine, label, version } → { token } */
import { signLicense, TOKEN_TTL_MS } from '../_licenseToken.js'
import { activate, findActivation, handle, isMachine, keys, LicenseError, planFor, str, validateKey } from '../_polar.js'

export function POST(request: Request): Promise<Response> {
  return handle(request, async (body) => {
    const key = str(body.key)
    const machine = str(body.machine)
    if (!key || !isMachine(machine)) throw new LicenseError(400, 'Enter your license key.')
    const { privateKey } = keys()
    const license = await validateKey(key)
    const aid = (await findActivation(license.id, machine)) ?? (await activate(key, machine, str(body.label, 60) || 'sldev-io', str(body.version, 40)))
    const now = Date.now()
    const token = signLicense(
      { v: 1, lid: license.id, aid, plan: await planFor(license), machine, email: license.customer?.email ?? null, iat: now, exp: now + TOKEN_TTL_MS },
      privateKey
    )
    return { token }
  })
}
