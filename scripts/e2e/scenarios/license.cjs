// Licenses in a stable build (beta builds are free and have no key field), against the harness's
// fake license server: bad key, activate, reuse on the same machine, deactivate, revoked key.
// The ended screen with a key field is covered by trial-ended.cjs.
const text = (h, sel) => h.js(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`)
const chips = (h) => h.js(`[...document.querySelectorAll('.statusbar .status-item')].map(e => e.textContent).join('|')`)

async function openLicense(h) {
  await h.click('.statusbar .status-item[title="Settings"]')
  await h.wait(600)
  await h.js(`document.getElementById('settings-license')?.scrollIntoView({ block: 'start' })`)
}

async function enterKey(h, key) {
  await h.setValue('#settings-license .license-form input', key)
  await h.click('#settings-license .license-form button[type=submit]')
  await h.wait(1200)
}

module.exports = async (h) => {
  await h.openFixture()
  await openLicense(h)
  h.expect((await text(h, '#settings-license')).includes('Trial: 14 days left'), 'stable build: trial and key field in Settings → License')
  h.expect(/trial · 14 days left/.test(await chips(h)), 'trial chip in the status bar')

  await enterKey(h, 'SLDEV-NOPE')
  h.expect((await text(h, '#settings-license .license-error')).includes("isn't valid"), 'unknown key: error shown')
  await h.shot('1-invalid-key')

  await enterKey(h, 'SLDEV-TEST-GOOD')
  const lic = await text(h, '#settings-license')
  h.expect(lic.includes('Licensed') && lic.includes('buyer@example.com'), 'valid key: licensed, email shown')
  h.expect(!/trial/.test(await chips(h)), 'licensed: trial chip gone')
  h.expect(h.licenses.get('SLDEV-TEST-GOOD').activations.size === 1, 'one activation on the server')
  await h.shot('2-licensed')

  // reinstalling on the same machine reuses the activation
  await h.js(`window.api.license.activate('SLDEV-TEST-GOOD')`)
  h.expect(h.licenses.get('SLDEV-TEST-GOOD').activations.size === 1, 'activating again on this machine uses no extra slot')

  await h.js('void (window.confirm = () => true)')
  await h.click('#settings-license .btn', 'Deactivate this machine')
  await h.wait(1200)
  h.expect(h.licenses.get('SLDEV-TEST-GOOD').activations.size === 0, 'deactivate frees the slot on the server')
  h.expect(!(await text(h, '#settings-license')).includes('Licensed'), 'deactivated: no longer licensed')

  // revoked or refunded: the next check drops the license
  await enterKey(h, 'SLDEV-TEST-GOOD')
  h.licenses.get('SLDEV-TEST-GOOD').revoked = true
  const status = await h.js('window.api.license.refresh().catch(e => ({ error: String(e) }))')
  h.expect(!status.licensed && /no longer active/i.test(status.message ?? ''), 'revoked key: license dropped with a message')
  await h.wait(300)
  await h.shot('3-revoked')
}
module.exports.env = { SLDEV_E2E_VERSION: '1.0.0' }
