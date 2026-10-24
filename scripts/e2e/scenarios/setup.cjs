// First-run setup check: opens on its own, lists tools, and runs a fix in a terminal.
// fakebin/gh is installed but logged out, so it shows "Needs setup" with a Fix button.
const fs = require('fs')
const path = require('path')

module.exports = async (h) => {
  await h.openFixture({ setupSeen: false })
  await h.wait(1500)
  h.expect(await h.js(`!!document.querySelector('.setup')`), 'setup panel opens on first run')
  h.expect(await h.js(`!!document.querySelector('.setup-row[data-check="git"] .setup-dot.is-ok')`), 'git is detected')
  h.expect(await h.js(`document.querySelector('.setup-row[data-check="gh"] .setup-state')?.textContent === 'Needs setup'`), 'logged-out gh needs setup')
  h.expect(await h.js(`!!document.querySelector('.setup-row[data-check="claude"] .setup-dot.is-ok')`), 'agent CLIs on PATH are listed as ready')
  await h.shot('1-setup')
  h.expect(await h.js(`window.api.settings.get().then(s => s.setupSeen)`), 'first run is remembered')

  h.expect(await h.click('.setup-row[data-check="gh"] .btn', 'Fix'), 'Fix button runs gh auth login')
  await h.wait(2000)
  h.expect(fs.existsSync(path.join(h.fixture, 'gh-login-marker.txt')), 'fix command ran in a terminal')
  await h.shot('2-fix-terminal')

  // after the first run, a reload with everything required present keeps the panel closed
  await h.js(`window.api.layout.save(null)`)
  await h.openFixture()
  h.expect(await h.js(`!document.querySelector('.setup')`), 'setup stays closed once seen')
  h.expect(await h.js(`!document.querySelector('.statusbar .attention')`), 'no setup warning when git is present')
}
