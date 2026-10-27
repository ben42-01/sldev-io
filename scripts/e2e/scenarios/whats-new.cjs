// What's new after an update, the beta feedback chip, the sound setting and the "needs you" badge.
const { app } = require('electron')
const text = (h, sel) => h.js(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`)

module.exports = async (h) => {
  const version = await h.js('window.api.app.info().then(i => i.version)')
  // pretend the last version that ran was the first beta
  await h.openFixture({ lastSeenVersion: '0.1.0-beta.1' })
  await h.until(() => h.js(`!!document.querySelector('.whats-new')`), 5000)
  const shown = await h.js(`[...document.querySelectorAll('.whats-new h3')].map(e => e.firstChild.textContent.trim())`)
  h.log('What\'s new lists', shown.join(', '))
  h.expect(shown[0] === version && !shown.includes('0.1.0-beta.1'), `opens with ${version} down to (not including) the last version seen`)
  h.expect((await text(h, '.whats-new .panel-page-head')).includes('since you last opened'), 'says it is what changed since last time')
  h.expect((await h.js('window.api.settings.get()')).lastSeenVersion === version, 'records the version as seen')
  await h.shot('1-whats-new')

  // starting again doesn't show the update notes again (a restored panel lists the whole changelog)
  await h.reload()
  h.expect(!(await text(h, '.whats-new')).includes('since you last opened'), 'not shown again for the same version')

  h.expect((await text(h, '.statusbar')).includes('feedback'), 'beta build: feedback chip in the status bar')

  h.key('P', ['control', 'shift'])
  await h.wait(400)
  await h.type("what's new")
  await h.wait(300)
  h.expect((await text(h, '.palette')).includes("What's new"), "command palette has What's new")
  h.key('Escape')
  await h.wait(200)

  // opened by hand it lists the whole released changelog
  await h.click('.statusbar .status-item[title="Settings"]')
  await h.wait(600)
  await h.js(`document.getElementById('settings-about')?.scrollIntoView({ block: 'start' })`)
  h.expect((await text(h, '#settings-about')).includes('Report a bug or idea'), 'About has Report a bug')
  h.expect((await h.js('document.body.textContent')).includes('Play a sound when a mission needs you'), 'sound setting in General')
  h.expect((await h.js('window.api.settings.get()')).notificationSound === false, 'sound is off by default')
  await h.click('#settings-about .btn', "What's new")
  await h.wait(600)
  const all = await h.js(`[...document.querySelectorAll('.whats-new h3')].length`)
  h.expect(all >= 4, `opened by hand: every released version (${all})`)
  await h.shot('2-about-and-changelog')

  // a mission that needs you sets the badge (macOS and Unity launchers; Windows uses an overlay)
  h.key('3', ['control', 'shift'])
  await h.wait(500)
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.setValue('.form textarea', 'Badge task')
  await h.wait(200)
  await h.click('.form .btn.primary', 'Launch')
  const needs = await h.until(() => h.js(`[...document.querySelectorAll('.mission-head .spill')].some(e => e.textContent === 'Needs you')`), 10000)
  h.expect(needs, 'mission reaches Needs you')
  const supported = app.setBadgeCount(app.getBadgeCount())
  if (supported) h.expect(app.getBadgeCount() === 1, 'badge shows 1 mission waiting')
  else h.log('badge count not supported by this desktop; skipped the count check')
  await h.shot('3-needs-you')
}
