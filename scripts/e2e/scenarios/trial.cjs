// A stable build without a license: trial chip, then the trial-ended screen at the next start.
const visible = (h, sel) => h.js(`!!document.querySelector(${JSON.stringify(sel)})`)

module.exports = async (h) => {
  await h.openFixture()
  const chip = await h.js(`[...document.querySelectorAll('.statusbar .status-item')].map(e => e.textContent).join('|')`)
  h.expect(/trial · 4 days left/.test(chip), `trial started 10 days ago: chip shows 4 days left (${chip})`)
  h.expect(!(await visible(h, '.beta-ended')), 'trial running: not locked')
  await h.shot('1-trial-chip')
}
module.exports.env = { SLDEV_E2E_VERSION: '1.0.0', SLDEV_TRIAL_DAYS_AGO: '10' }
