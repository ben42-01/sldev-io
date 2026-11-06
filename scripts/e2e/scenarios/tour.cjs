// A visual tour of the main surfaces in the dark and the light theme, one screenshot each, with seeded missions.
// It checks that each surface opens and that Settings → Appearance switches everything (page, terminals, palette
// recents); read the screenshots in .e2e-out/tour/ to judge the look after a styling change.
module.exports = async (h) => {
  const now = Date.now()
  const min = 60000
  const m = (id, title, status, ago, extra = {}) => ({
    id, title, prompt: title, root: h.fixture, cwd: h.fixture, options: { agent: 'claude' }, status,
    createdAt: now - ago - 20 * min, updatedAt: now - ago,
    history: [{ status: 'working', at: now - ago - 20 * min }, { status, at: now - ago }],
    lastMessage: 'Done. Tests pass.', ...extra
  })
  const missions = [
    m('t1', 'Add rate limiting to the API', 'ended', 30 * min, { stats: { files: 4, insertions: 120, deletions: 12 } }),
    m('t2', 'Research: why is checkout slow', 'ended', 90 * min, { kind: { id: 'research', name: 'Research', readOnly: true } }),
    m('t3', 'Fix flaky login test', 'failed', 3 * 60 * min, { options: { agent: 'codex' } })
  ]
  await h.js(`window.api.store.set('missions', ${JSON.stringify({ missions })})`)
  await h.openFixture({ rightPanelVisible: true, theme: 'dark' })
  h.expect(await h.js(`document.documentElement.dataset.theme === 'dark'`), 'dark is the default theme')

  const surfaces = async (prefix) => {
    await h.shot(`${prefix}-01-welcome`)
    for (const label of ['Runtimes', 'Factory', 'Tasks', 'Explorer']) {
      await h.click(`.activitybar:not(.right) .activity-btn[aria-label^="${label}"]`)
      await h.wait(400)
    }
    await h.shot(`${prefix}-02-explorer`)
    await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Mission Control"]')
    h.expect(await h.until(() => h.js(`!!document.querySelector('.mc')`), 3000), `${prefix}: Mission Control opens`)
    await h.wait(500)
    await h.shot(`${prefix}-03-mission-control`)
    h.key('T', ['control', 'shift'])
    await h.wait(1500)
    h.type('git log --oneline && ls\r')
    await h.wait(800)
    await h.shot(`${prefix}-04-terminal`)
    h.key('P', ['control', 'shift'])
    await h.wait(300)
    h.type('term')
    await h.wait(700)
    h.expect(await h.js(`!!document.querySelector('.palette-title mark')`), `${prefix}: the palette marks the matched letters`)
    await h.shot(`${prefix}-05-palette`)
    h.key('Escape')
    h.key('M', ['control', 'shift'])
    await h.wait(900)
    await h.shot(`${prefix}-06-new-mission`)
    h.key('Escape')
    await h.wait(300)
    h.key(',', ['control'])
    h.expect(await h.until(() => h.js(`!!document.querySelector('.settings .theme-picker')`), 3000), `${prefix}: Settings shows the theme picker`)
    await h.wait(900)
    await h.shot(`${prefix}-07-settings`)
  }

  await surfaces('dark')

  // Settings → Appearance → Light: the page, the terminals and the saved setting all follow
  await h.click('.theme-tile', 'Light')
  h.expect(await h.until(() => h.js(`document.documentElement.dataset.theme === 'light'`), 2000), 'the Light tile switches the page to light')
  h.expect(await h.js(`document.querySelector('.theme-tile.on')?.textContent.includes('Light')`), 'the Light tile shows it is chosen')
  h.expect(await h.until(() => h.js(`window.api.settings.get().then(s => s.theme === 'light')`), 2000), 'the choice is saved')
  h.expect(
    await h.js(`getComputedStyle(document.body).backgroundColor !== 'rgb(10, 10, 10)'`),
    'the page background is no longer the dark one'
  )
  await h.wait(400)
  await h.shot('light-00-settings')

  // Interface size: Large zooms the whole window (fewer CSS pixels across), Default puts it back
  const width = await h.js('window.innerWidth')
  await h.setValue('.settings .narrow-select select', '1.1')
  h.expect(await h.until(async () => (await h.js('window.innerWidth')) < width * 0.95, 3000), 'Large interface size zooms the window')
  h.expect(await h.until(() => h.js(`window.api.settings.get().then(s => s.uiZoom === 1.1)`), 2000), 'the size is saved')
  await h.wait(400)
  await h.shot('light-00b-settings-large')
  await h.setValue('.settings .narrow-select select', '1')
  h.expect(await h.until(async () => (await h.js('window.innerWidth')) === width, 3000), 'Default puts the size back')

  // a reload keeps it (a relaunch also paints light from the first frame: main passes the theme to the preload,
  // which a reload of the same window can't show, see test/theme.test.ts)
  await h.reload()
  await h.wait(1500)
  h.expect(await h.js(`document.documentElement.dataset.theme === 'light'`), 'a reload stays light')
  // close the restored tabs so the welcome screen shows
  await h.js(`document.querySelectorAll('.dv-default-tab-action, .dv-tab .tab-close').forEach(b => b.click())`)
  await h.wait(500)
  await surfaces('light')

  // the palette puts what was run last at the top
  h.key('P', ['control', 'shift'])
  await h.wait(300)
  h.type('Toggle light')
  await h.wait(200)
  h.key('Enter')
  const back = await h.until(() => h.js(`document.documentElement.dataset.theme === 'dark'`), 2000)
  if (!back) h.log('after toggle', await h.js(`window.api.settings.get().then(s => JSON.stringify({ pref: s.theme, theme: document.documentElement.dataset.theme }))`))
  h.expect(back, 'the palette command toggles back to dark')
  h.key('P', ['control', 'shift'])
  await h.wait(300)
  h.expect(
    await h.js(`(() => { const first = document.querySelector('.palette-item'); return first?.textContent.includes('Toggle light') && !!first.querySelector('.palette-recent') })()`),
    'the command run last comes first, marked recent'
  )
  h.key('Escape')
}
