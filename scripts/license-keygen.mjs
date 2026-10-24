// Creates the Ed25519 key pair that signs license tokens.
//   node scripts/license-keygen.mjs [private-key-file]
// The public key goes into src/main/licenseKey.ts (commit it). The private key is written to a
// file outside the repo (default ~/sldev-io-license-signing-key.txt, mode 600) and never printed:
// paste it into Vercel as LICENSE_SIGNING_KEY (Preview and Production), keep a copy in your
// password manager, then delete the file. Running this again replaces the pair, and licenses
// issued with the old key stop working in builds that ship the new public key.
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const out = resolve(process.argv[2] ?? join(homedir(), 'sldev-io-license-signing-key.txt'))
if (existsSync(out)) {
  console.error(`${out} already exists; move it away first.`)
  process.exit(1)
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
writeFileSync(out, privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') + '\n', { mode: 0o600 })
writeFileSync(
  new URL('../src/main/licenseKey.ts', import.meta.url),
  `// Public half of the license signing key (base64 SPKI DER), written by scripts/license-keygen.mjs.
// Not secret. Empty = licensing is off in this build. The private half is LICENSE_SIGNING_KEY in Vercel.
export const LICENSE_PUBLIC_KEY = '${pub}'
`
)
console.log(`public key written to src/main/licenseKey.ts`)
console.log(`private key written to ${out} (not printed)`)
