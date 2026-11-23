// Add a team from the Agents panel: preview the roles, install the Software team, see it grouped under its
// name, install again without overwriting anything, then start a mission with the team's Reviewer.
const fs = require('fs')
const path = require('path')

module.exports = async (h) => {
  const dir = path.join(h.fixture, '.sldev', 'agents')
  await h.openFixture()
  const toast = () => h.js(`document.querySelector('.toast')?.textContent ?? ''`)

  // the Agents panel, from the palette
  await h.js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true }))`)
  await h.wait(300)
  h.type('agents dashboard')
  await h.wait(300)
  h.key('Return')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.agents-board')`), 4000), 'the Agents panel opens')
  h.expect(!(await h.js(`!!document.querySelector('.team-strip')`)), 'no team strip before a team is installed')

  // the dialog previews every role before anything is written
  await h.click('.agents-board .btn', 'Add a team')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.team-preview')`), 3000), 'Add a team opens with a preview')
  const roles = await h.js(`[...document.querySelectorAll('.team-role-preview summary b')].map(b => b.textContent)`)
  h.expect(JSON.stringify(roles) === JSON.stringify(['Product owner', 'Tech lead', 'Implementer', 'Reviewer', 'QA', 'Release manager']), `the preview lists the six roles in order (${roles})`)
  h.expect(!fs.existsSync(dir), 'nothing is written before Install')
  await h.js(`[...document.querySelectorAll('.team-role-preview summary')].find(s => s.textContent.includes('Reviewer')).click()`)
  await h.wait(500)
  h.expect(await h.js(`document.querySelector('.team-role-preview details[open] .team-role-text')?.textContent.length > 40`), "a role opens to show its instructions")
  await h.shot('0-preview')
  h.expect(await h.js(`document.querySelector('.modal-footer .btn.primary')?.textContent.includes('Install 6 roles')`), 'the button says how many roles it writes')
  await h.click('.modal-footer .btn.primary')
  h.expect(await h.until(() => h.js(`!document.querySelector('.team-preview')`), 4000), 'the dialog closes after installing')
  h.expect((await toast()).includes('Installed Software team: 6 roles'), `the toast says what was installed (${await toast()})`)
  h.expect(fs.readdirSync(dir).length === 6, 'six files in .sldev/agents')

  // grouped under the team's name
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.team-strip .team-role').length === 6`), 3000), 'the six roles show in the panel')
  h.expect(await h.js(`document.querySelector('.team-group-head b')?.textContent === 'Software team'`), 'grouped under the team name')
  await h.wait(600)
  await h.shot('1-installed')

  // a hand edit and a removed role: installing again writes only the missing one and names what it kept
  const reviewerFile = path.join(dir, 'reviewer.md')
  const edited = fs.readFileSync(reviewerFile, 'utf8') + '\nAlso check the docs.\n'
  fs.writeFileSync(reviewerFile, edited)
  fs.rmSync(path.join(dir, 'tech-lead.md'))
  await h.wait(3500) // let the first toast go
  await h.click('.agents-board .btn', 'Add a team')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.team-role-preview .chip').length === 6 && [...document.querySelectorAll('.team-role-preview .chip')].filter(c => c.textContent === 'kept').length === 5`), 3000), 'the preview marks the five files that will be kept')
  h.expect(await h.js(`document.querySelector('.modal-footer .btn.primary')?.textContent.includes('Install 1 role')`), 'and installs only the missing one')
  await h.wait(300)
  await h.shot('2-again')
  await h.click('.modal-footer .btn.primary')
  h.expect(await h.until(() => h.js(`document.querySelector('.toast')?.textContent.includes('kept')`), 4000), 'a toast after the second install')
  const t = await toast()
  h.expect(t.includes('1 role') && ['product-owner.md', 'implementer.md', 'reviewer.md', 'qa.md', 'release-manager.md'].every((f) => t.includes(f)), `the toast names every kept file (${t})`)
  h.expect(fs.readFileSync(reviewerFile, 'utf8') === edited, 'the hand-edited reviewer.md is untouched')
  await h.shot('3-kept-toast')

  // with everything there, there is nothing to install
  await h.click('.agents-board .btn', 'Add a team')
  h.expect(await h.until(() => h.js(`document.querySelector('.modal-footer .btn.primary')?.textContent.includes('Already installed') && document.querySelector('.modal-footer .btn.primary').disabled`), 3000), 'a full team says Already installed')
  h.key('Escape')
  await h.wait(300)

  // the Reviewer role starts a mission with that profile
  await h.click('.team-strip .team-role', 'Reviewer')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.form textarea')`), 3000), 'New mission opens')
  const picked = await h.js(`[...document.querySelectorAll('.form select')].map(s => s.value).find(v => v.startsWith('project:'))`)
  h.expect(picked?.endsWith('reviewer.md'), `the Reviewer profile is picked (${picked})`)
  h.expect(await h.js(`[...document.querySelectorAll('.form select optgroup')].some(g => g.label === 'Software team' && g.querySelectorAll('option').length === 6)`), 'the profile picker groups the team under its name')
  await h.setValue('.form textarea', 'Review the last commit')
  await h.wait(600) // the dialog fades in
  await h.shot('4-mission-form')
  await h.click('.form .btn.primary', 'Launch')
  await h.wait(2500)
  const m = (await h.js(`window.api.store.get('missions')`)).missions[0]
  h.expect(m?.options.profile === picked && m.brief === 'Review the last commit', 'the mission runs with the Reviewer profile')
  h.key('3', ['control', 'shift']) // the right panel's missions tab
  h.expect(await h.until(() => h.js(`document.querySelector('.mission-card .mission-agent')?.textContent.startsWith('Reviewer · ')`), 3000), 'the mission card shows the Reviewer profile')
  await h.shot('5-mission')
}
