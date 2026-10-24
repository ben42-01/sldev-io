// Settings → About: version, update state (unsupported when unpacked), diagnostics, legal links.
// Also: a beta build is free, so Settings → License has no key field.
const text = (h, sel) => h.js(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`)

module.exports = async (h) => {
  await h.openFixture()
  await h.click('.statusbar .status-item[title="Settings"]')
  await h.wait(600)
  await h.js(`document.getElementById('settings-about')?.scrollIntoView({ block: 'start' })`)
  await h.wait(300)
  const version = await h.js('window.api.app.info().then(i => i.version)')
  h.expect((await text(h, '.about-name')).includes(version), `About shows the version (${version})`)
  h.expect((await text(h, '.about-details')).includes('Electron'), 'About lists Electron and system details')
  h.expect((await text(h, '#settings-about')).includes('not in development builds'), 'unpacked build: updates reported as unsupported')
  const status = await h.js('window.api.update.status()')
  h.expect(status.state === 'unsupported', 'updater stays off in the unpacked build')
  h.expect((await h.js(`[...document.querySelectorAll('.about-links .link')].map(e => e.textContent).join('|')`)).includes('Privacy policy'), 'legal links present')
  h.expect(!(await h.js(`!!document.querySelector('.statusbar .status-item.ok')`)), 'no update chip without an update')
  h.expect((await text(h, '#settings-license')).includes('Free during the beta'), 'beta build: License says free during the beta')
  h.expect(!(await h.js(`!!document.querySelector('#settings-license .license-form')`)), 'beta build: no license key field')
  const refused = await h.js(`window.api.license.activate('SLDEV-TEST-GOOD').then(() => 'activated', e => String(e))`)
  h.expect(/from sldev-io 1\.0/.test(refused), 'beta build: main refuses to activate a key')
  await h.shot('1-about')
}
