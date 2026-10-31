// The free-beta window from /beta.json: no limit, countdown + banner, ended screen, reopening.
const visible = (h, sel) => h.js(`!!document.querySelector(${JSON.stringify(sel)})`)
const text = (h, sel) => h.js(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`)

const { version } = require('../../../package.json')

module.exports = async (h) => {
  await h.openFixture()
  h.expect(!(await visible(h, '.beta-banner')) && !(await visible(h, '.beta-ended')), 'no dates: no banner, no lock')

  // a stable build ignores the beta window: no countdown, no banner, and an ended beta never locks it
  if (!/-beta\b/.test(version)) {
    h.setBeta({ endsInDays: 5 })
    await h.js('window.api.beta.refresh()')
    await h.reload()
    const chips = await h.js(`[...document.querySelectorAll('.statusbar .status-item')].map(e => e.textContent).join('|')`)
    h.expect(!(await visible(h, '.beta-banner')) && !/beta ·/.test(chips), `stable ${version}: no beta countdown or banner`)
    h.setBeta({ endsInDays: -1 })
    await h.js('window.api.beta.refresh()')
    await h.reload()
    h.expect(!(await visible(h, '.beta-ended')) && (await visible(h, '.statusbar')), `stable ${version}: an ended beta doesn't lock it`)
    await h.shot('1-stable')
    return
  }

  h.setBeta({ endsInDays: 40 })
  await h.js('window.api.beta.refresh()')
  await h.reload()
  h.expect(!(await visible(h, '.beta-banner')), '40 days left: no banner yet')
  h.expect(/beta · \d+ days left/.test(await h.js(`[...document.querySelectorAll('.statusbar .status-item')].map(e => e.textContent).join('|')`)), '40 days left: status-bar chip')

  h.setBeta({ endsInDays: 5 })
  await h.js('window.api.beta.refresh()')
  await h.reload()
  h.expect((await text(h, '.beta-banner')).includes('days left'), '5 days left: warning banner')
  await h.shot('1-ending-banner')

  // the beta ends while the app is running: no lock until the next launch
  h.setBeta({ endsInDays: -1 })
  await h.js('window.api.beta.refresh()')
  await h.wait(500)
  h.expect(!(await visible(h, '.beta-ended')), 'ended mid-session: running session is not locked')
  await h.reload()
  h.expect(await visible(h, '.beta-ended'), 'ended: next launch shows the ended screen')
  h.expect((await h.js(`document.querySelectorAll('.xterm').length`)) === 0, 'ended: no terminals are started')
  await h.shot('2-ended')

  // extending the beta reopens it from the ended screen
  h.setBeta({ endsInDays: 30 })
  await h.click('.beta-ended .btn', 'Check again')
  await h.wait(2500)
  h.expect(!(await visible(h, '.beta-ended')) && (await visible(h, '.statusbar')), 'extended: "Check again" reopens the workspace')
  await h.shot('3-reopened')
}
