// Plans with buy buttons in Settings → License during the trial, and on the trial-ended screen.
// Buttons aren't clicked (that would open a real browser); their checkout links are checked instead.
const plans = (h, root) =>
  h.js(`[...document.querySelectorAll(${JSON.stringify(`${root} .plan-card`)})].map(c => ({ plan: c.dataset.plan, price: c.querySelector('.plan-price')?.textContent, href: c.querySelector('button')?.dataset.href }))`)

module.exports = async (h) => {
  await h.openFixture()
  await h.click('.statusbar .status-item', 'trial')
  await h.wait(800)
  await h.js(`document.getElementById('settings-license')?.scrollIntoView({ block: 'start' })`)
  await h.wait(300)
  const cards = await plans(h, '#settings-license')
  h.expect(cards.length === 2, `two plans in Settings → License (${JSON.stringify(cards)})`)
  h.expect(cards.find((c) => c.plan === 'personal')?.price === '€10.99', 'Personal shows its price from pricing.json')
  h.expect(cards.every((c) => /^https:\/\/buy\.polar\.sh\//.test(c.href ?? '')), 'buy buttons link Polar live checkout')
  h.expect(await h.js(`!!document.querySelector('#settings-license .license-form input')`), 'key field is still under the plans')
  await h.shot('1-settings-plans')
}
module.exports.env = { SLDEV_E2E_VERSION: '1.0.0', SLDEV_TRIAL_DAYS_AGO: '10' }
