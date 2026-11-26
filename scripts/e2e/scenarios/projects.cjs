// Several projects at once: a mission in another project that needs you shows in the title bar's project menu and
// in Mission Control, whose All projects view names each mission's project, and the menu switches projects.
const fs = require('fs')
const os = require('os')
const path = require('path')

module.exports = async (h) => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'sldev-e2e-other-'))
  const name = path.basename(other)
  await h.openFixture({ missionScope: 'project', missionLayout: 'columns' })
  h.expect(await h.until(() => h.js(`document.querySelector('.titlebar-project')?.textContent.includes('project')`), 3000), 'the title bar names the open project')

  // a mission in the other folder that stops at an approval prompt
  h.key('3', ['control', 'shift'])
  await h.wait(500)
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.setValue('.path-input input', other)
  await h.setValue('.form select', 'codex', `e.querySelector('option[value=codex]')`)
  await h.setValue('.form textarea', 'Run the tests ASK_SCREEN')
  await h.wait(300)
  await h.click('.form .btn.primary', 'Launch')
  h.expect(await h.until(() => h.js(`document.querySelector('.titlebar-elsewhere')?.textContent === '+1'`), 12000), 'the title bar says another project needs you')
  await h.shot('1-titlebar')

  // Mission Control on this project says so too, and All projects shows the mission with its project
  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Mission Control"]')
  h.expect(await h.until(() => h.js(`document.querySelector('.mc-elsewhere')?.textContent.includes('${name} needs you')`), 3000), 'Mission Control: a mission in another project needs you')
  await h.wait(300)
  await h.shot('2-this-project')
  await h.click('.mc-elsewhere .btn', 'Show all projects')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.mission-project')].some(c => c.textContent === '${name}')`), 3000), 'All projects: the card names its project')
  h.expect(await h.js(`window.api.settings.get().then(s => s.missionScope === 'all')`), 'the view is remembered')
  await h.wait(300)
  await h.shot('3-all-projects')
  await h.click('.mc .seg button', 'Grid')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.mc-group-head')].map(g => g.textContent).join('|').includes('${name}')`), 3000), 'grid: missions grouped by project')
  await h.wait(300)
  await h.shot('4-grouped')
  await h.click('.mc .seg button', 'Columns')

  // the project menu lists it with what it has going, and picking it switches
  await h.click('.titlebar-project')
  await h.wait(600)
  const menu = await h.js(`document.querySelector('.ctx-menu')?.textContent ?? ''`)
  h.expect(menu.includes(name) && menu.includes('1 needs you'), `the project menu lists the other project and its work (${menu})`)
  await h.shot('5-menu')
  await h.click('.ctx-item', name)
  h.expect(await h.until(() => h.js(`window.api.settings.get().then(s => s.rootFolder === ${JSON.stringify(other)})`), 3000), 'picking it opens that project')
  h.expect(await h.until(() => h.js(`document.querySelector('.titlebar-project')?.textContent.includes('${name}')`), 3000), 'the title bar names it')
  h.expect(await h.js(`!document.querySelector('.titlebar-elsewhere')`), 'nothing elsewhere needs you now')
  await h.wait(300)
  await h.shot('6-switched')
}
