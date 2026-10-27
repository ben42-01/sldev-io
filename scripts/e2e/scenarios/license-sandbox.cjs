// Manual check against a real license server (a Vercel preview using the Polar sandbox):
//   SLDEV_SANDBOX_API=https://<preview>/api/license SLDEV_SANDBOX_KEY=<sandbox key> npm run e2e -- license-sandbox
// Activates through Settings → License, checks the license, then deactivates so no slot stays used.
const text = (h, sel) => h.js(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`)

module.exports = async (h) => {
  if (!process.env.SLDEV_SANDBOX_KEY) return h.expect(false, 'set SLDEV_SANDBOX_API and SLDEV_SANDBOX_KEY')
  await h.openFixture()
  await h.click('.statusbar .status-item[title="Settings"]')
  await h.wait(600)
  await h.js(`document.getElementById('settings-license')?.scrollIntoView({ block: 'start' })`)
  await h.setValue('#settings-license .license-form input', process.env.SLDEV_SANDBOX_KEY)
  await h.click('#settings-license .license-form button[type=submit]')
  await h.until(async () => (await text(h, '#settings-license')).includes('Licensed'), 20000)
  h.expect((await text(h, '#settings-license')).includes('Licensed'), 'sandbox key activates in the app')
  await h.shot('1-licensed')
  const checked = await h.js('window.api.license.refresh().then(s => s.licensed).catch(e => String(e))')
  h.expect(checked === true, `"Check license" renews it (${checked})`)
  await h.click('#settings-license .btn', 'Deactivate this machine')
  await h.wait(300)
  await h.click('dialog[open] .btn', 'Deactivate')
  await h.until(async () => !(await text(h, '#settings-license')).includes('Licensed'), 20000)
  h.expect(!(await text(h, '#settings-license')).includes('Licensed'), 'deactivated again')
}
module.exports.env = { SLDEV_E2E_VERSION: '1.0.0', SLDEV_LICENSE_API: process.env.SLDEV_SANDBOX_API ?? '' }
