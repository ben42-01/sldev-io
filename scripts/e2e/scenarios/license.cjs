// Licenses in a beta build, against the harness's fake license server: bad key, activate,
// survives the beta ending, deactivate, ended screen → activate unlocks, revoked key.
const text = (h, sel) => h.js(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`)
const visible = (h, sel) => h.js(`!!document.querySelector(${JSON.stringify(sel)})`)

async function openLicense(h) {
  await h.click('.statusbar .status-item[title="Settings"]')
  await h.wait(600)
  await h.js(`document.getElementById('settings-license')?.scrollIntoView({ block: 'start' })`)
}

async function enterKey(h, scope, key) {
  await h.setValue(`${scope} .license-form input`, key)
  await h.click(`${scope} .license-form button[type=submit]`)
  await h.wait(1200)
}

module.exports = async (h) => {
  h.setBeta({ endsInDays: 30 })
  await h.js('window.api.beta.refresh()')
  await h.openFixture()
  await openLicense(h)
  h.expect((await text(h, '#settings-license')).includes('free until'), 'beta build: license section mentions the beta end date')

  await enterKey(h, '#settings-license', 'SLDEV-NOPE')
  h.expect((await text(h, '#settings-license .license-error')).includes("isn't valid"), 'unknown key: error shown')
  await h.shot('1-invalid-key')

  await enterKey(h, '#settings-license', 'SLDEV-TEST-GOOD')
  const lic = await text(h, '#settings-license')
  h.expect(lic.includes('Licensed') && lic.includes('buyer@example.com'), 'valid key: licensed, email shown')
  h.expect(h.licenses.get('SLDEV-TEST-GOOD').activations.size === 1, 'one activation on the server')
  await h.shot('2-licensed')

  // reinstalling on the same machine reuses the activation
  await h.js(`window.api.license.activate('SLDEV-TEST-GOOD')`)
  h.expect(h.licenses.get('SLDEV-TEST-GOOD').activations.size === 1, 'activating again on this machine uses no extra slot')

  h.setBeta({ endsInDays: -1 })
  await h.js('window.api.beta.refresh()')
  await h.reload()
  h.expect(!(await visible(h, '.beta-ended')) && (await visible(h, '.statusbar')), 'licensed: the ended beta does not lock the app')

  await openLicense(h)
  await h.js('void (window.confirm = () => true)')
  await h.click('#settings-license .btn', 'Deactivate this machine')
  await h.wait(1200)
  h.expect(h.licenses.get('SLDEV-TEST-GOOD').activations.size === 0, 'deactivate frees the slot on the server')
  h.expect(!(await text(h, '#settings-license')).includes('Licensed'), 'deactivated: no longer licensed')

  await h.reload()
  h.expect(await visible(h, '.beta-ended .license-form'), 'beta ended, no license: ended screen offers the key field')
  await h.shot('3-ended-with-key-field')
  await enterKey(h, '.beta-ended', 'SLDEV-TEST-GOOD')
  await h.wait(2500)
  h.expect(!(await visible(h, '.beta-ended')) && (await visible(h, '.statusbar')), 'activating on the ended screen opens the workspace')

  // revoked or refunded: the next check drops the license
  h.licenses.get('SLDEV-TEST-GOOD').revoked = true
  const status = await h.js('window.api.license.refresh().catch(e => ({ error: String(e) }))')
  h.expect(!status.licensed && /enter a license key/i.test(status.message ?? ''), 'revoked key: license dropped with a message')
  await openLicense(h)
  await h.wait(300)
  await h.shot('4-revoked')
}
