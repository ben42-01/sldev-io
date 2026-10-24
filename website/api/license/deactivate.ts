/** POST /api/license/deactivate { token, key } → {}: frees this machine's slot. */
import { verifyLicense } from '../_licenseToken.js'
import { deactivate, handle, keys, LicenseError, str } from '../_polar.js'

export function POST(request: Request): Promise<Response> {
  return handle(request, async (body) => {
    const claims = verifyLicense(str(body.token, 4000), keys().publicKey)
    const key = str(body.key)
    if (!claims || !key) throw new LicenseError(400, 'Bad request.')
    await deactivate(key, claims.aid)
    return {}
  })
}
