// A stable build whose trial ended: the ended screen with the key field; a key unlocks it.
const visible = (h, sel) => h.js(`!!document.querySelector(${JSON.stringify(sel)})`)

module.exports = async (h) => {
  await h.openFixture()
  h.expect(await visible(h, '.beta-ended'), 'trial over: ended screen at start')
  h.expect((await h.js(`document.querySelector('.beta-ended h1')?.textContent`)).includes('trial'), 'ended screen talks about the trial')
  await h.shot('1-trial-ended')
  await h.setValue('.beta-ended .license-form input', 'SLDEV-TEST-GOOD')
  await h.click('.beta-ended .license-form button[type=submit]')
  await h.wait(3500)
  h.expect(!(await visible(h, '.beta-ended')) && (await visible(h, '.statusbar')), 'a key unlocks the workspace')
  h.expect(!(await h.js(`[...document.querySelectorAll('.statusbar .status-item')].some(e => e.textContent.includes('trial'))`)), 'licensed: no trial chip')
}
module.exports.env = { SLDEV_E2E_VERSION: '1.0.0', SLDEV_TRIAL_DAYS_AGO: '20' }
