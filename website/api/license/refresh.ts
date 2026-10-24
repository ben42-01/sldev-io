/** POST /api/license/refresh { token, key } → { token }; 403 once the key is revoked, refunded or deactivated. */
import { signLicense, TOKEN_TTL_MS, verifyLicense } from '../_licenseToken.js'
import { handle, keys, LicenseError, planFor, str, validateKey } from '../_polar.js'

export function POST(request: Request): Promise<Response> {
  return handle(request, async (body) => {
    const { privateKey, publicKey } = keys()
    const old = verifyLicense(str(body.token, 4000), publicKey)
    const key = str(body.key)
    if (!old || !key) throw new LicenseError(400, 'Bad request.')
    // the activation must still exist and belong to this key
    const license = await validateKey(key, old.aid)
    if (license.id !== old.lid) throw new LicenseError(403, 'This license is no longer active on this machine.')
    const now = Date.now()
    return { token: signLicense({ ...old, plan: await planFor(license), email: license.customer?.email ?? old.email, iat: now, exp: now + TOKEN_TTL_MS }, privateKey) }
  })
}
