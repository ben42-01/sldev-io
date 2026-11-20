// Settings → About: version, update state (unsupported when unpacked), diagnostics, legal links.
// sldev-io is free: no license section, no trial chip, a Star and a Sponsor button instead.
const text = (h, sel) => h.js(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`)

module.exports = async (h) => {
  await h.openFixture()
  const version = await h.js('window.api.app.info().then(i => i.version)')
  h.expect((await text(h, '.titlebar-version')) === `v${version}`, 'title bar shows the version')
  await h.shot('0-titlebar')
  await h.click('.titlebar-version')
  await h.wait(600)
  await h.js(`document.getElementById('settings-about')?.scrollIntoView({ block: 'start' })`)
  await h.wait(300)
  h.expect(await h.js(`!!document.getElementById('settings-about')`), 'clicking the version opens Settings → About')
  h.expect((await text(h, '.about-name')).includes(version), `About shows the version (${version})`)
  h.expect((await text(h, '.about-details')).includes('Electron'), 'About lists Electron and system details')
  h.expect((await text(h, '#settings-about')).includes('not in development builds'), 'unpacked build: updates reported as unsupported')
  const status = await h.js('window.api.update.status()')
  h.expect(status.state === 'unsupported', 'updater stays off in the unpacked build')
  h.expect((await h.js(`[...document.querySelectorAll('.about-links .link')].map(e => e.textContent).join('|')`)).includes('Privacy policy'), 'legal links present')
  h.expect(!(await h.js(`!!document.querySelector('.statusbar .status-item.ok')`)), 'no update chip without an update')
  h.expect(!(await h.js(`!!document.getElementById('settings-license')`)), 'no License section: the app is free')
  h.expect(!/trial|license/i.test(await text(h, '.statusbar')), 'no trial or license chip in the status bar')
  const sponsor = await text(h, '.about-sponsor')
  h.expect(sponsor.includes('Star on GitHub') && sponsor.includes('Sponsor'), 'About offers Star on GitHub and Sponsor')
  h.expect(await h.js(`!('license' in window.api) && !('beta' in window.api)`), 'no license or beta API in the preload bridge')
  await h.shot('1-about')
}
