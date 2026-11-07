// The start screen and the Overview's week: greeting, brief box with starters, missions to pick up again,
// and a week of seeded missions in the Overview. Screenshots in dark and light.
module.exports = async (h) => {
  const now = Date.now()
  const min = 60000
  const day = 24 * 60 * min
  const m = (id, title, status, ago, mins, extra = {}) => ({
    id, title, prompt: title, root: h.fixture, cwd: h.fixture, options: { agent: 'claude' }, status,
    createdAt: now - ago - mins * min, updatedAt: now - ago,
    history: [{ status: 'working', at: now - ago - mins * min }, { status, at: now - ago }],
    lastMessage: 'Done. Tests pass.', ...extra
  })
  const missions = [
    m('w1', 'Add rate limiting to the API', 'ended', 30 * min, 25, { stats: { files: 4, insertions: 120, deletions: 12 } }),
    m('w2', 'Research: why is checkout slow', 'ended', 90 * min, 15, { kind: { id: 'research', name: 'Research', readOnly: true } }),
    m('w3', 'Fix flaky login test', 'failed', 3 * 60 * min, 10, { options: { agent: 'codex' } }),
    m('w4', 'Migrate settings to zod', 'ended', 1 * day, 40),
    m('w5', 'Write tests for the cart', 'ended', 1 * day + 2 * 60 * min, 35),
    m('w6', 'Upgrade to React 19', 'ended', 2 * day, 70, { options: { agent: 'codex' } }),
    m('w7', 'Plan: offline mode', 'ended', 3 * day, 20),
    m('w8', 'Dark mode for emails', 'ended', 4 * day, 30),
    m('w9', 'Tidy the README', 'ended', 4 * day + 60 * min, 8),
    m('w10', 'Cache the product list', 'ended', 6 * day, 45)
  ]

  // no project: the start screen asks for one
  await h.shot('00-no-project')
  h.expect(await h.js(`document.querySelector('.welcome h1')?.textContent.includes('sldev-io')`), 'without a project the start screen names the app')

  await h.js(`window.api.store.set('missions', ${JSON.stringify({ missions })})`)
  await h.openFixture({ rightPanelVisible: true, theme: 'dark' })
  h.expect(await h.until(() => h.js(`!!document.querySelector('.welcome .hero-form input')`), 3000), 'the start screen offers a brief box')
  h.expect(await h.js(`/Good|Working late/.test(document.querySelector('.welcome h1').textContent)`), 'the start screen greets you')
  h.expect(await h.js(`document.querySelectorAll('.welcome .resume-row').length === 3`), 'the three latest missions can be picked up again')
  await h.shot('01-home-dark')

  // a starter that needs finishing puts its opener in the box and focuses it
  await h.click('.welcome .starter', 'Write tests')
  await h.wait(200)
  h.expect(await h.js(`document.activeElement === document.querySelector('.welcome .hero-form input') && document.activeElement.value === 'Add tests for '`), 'Write tests fills in an opener to finish')
  h.type('the checkout flow')
  await h.wait(200)
  await h.shot('02-starter')
  await h.js(`document.querySelector('.welcome .hero-form').requestSubmit()`)
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open] .mission-form textarea')?.value === 'Add tests for the checkout flow'`), 2000), 'Launch opens New mission with the brief')
  h.key('Escape')
  await h.wait(300)

  // a complete starter opens the form straight away, with its kind
  await h.click('.welcome .starter', 'Review my changes')
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open] .seg button.on, dialog[open] [aria-pressed="true"]')?.textContent.includes('Review') ?? !!document.querySelector('dialog[open] .mission-form')`), 2000), 'Review my changes opens the form')
  await h.shot('03-review-starter')
  h.key('Escape')
  await h.wait(300)

  // the Overview shows the week
  h.expect(await h.until(() => h.js(`!!document.querySelector('.ov-week')`), 2000), 'the Overview shows this week')
  await h.shot('04-overview-week')

  // Settings: the section links stay on one line and mark the section in view
  h.key(',', ['control'])
  h.expect(await h.until(() => h.js(`!!document.querySelector('.settings-nav button.on')`), 3000), 'Settings marks the section in view')
  h.expect(await h.js(`(() => { const b = [...document.querySelectorAll('.settings-nav button')]; return b.every(x => x.offsetTop === b[0].offsetTop) })()`), 'the section links stay on one line')
  await h.js(`(() => { const b = [...document.querySelectorAll('.settings-nav button')].find(x => x.textContent === 'Agents'); b.click() })()`)
  h.expect(await h.until(() => h.js(`document.querySelector('.settings-nav button.on')?.textContent === 'Agents'`), 3000), 'jumping to a section marks it')
  await h.wait(300)
  await h.shot('04b-settings-nav')

  await h.js(`window.api.settings.set({ theme: 'light' })`)
  await h.reload()
  await h.wait(1500)
  await h.js(`document.querySelectorAll('.dv-default-tab-action, .dv-tab .tab-close').forEach(b => b.click())`)
  await h.wait(500)
  await h.shot('05-home-light')
}
