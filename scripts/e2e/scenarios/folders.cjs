// Missions, skills and factory runs can work in a folder other than the open project.
const fs = require('fs')
const os = require('os')
const path = require('path')

module.exports = async (h) => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'sldev-e2e-other-'))
  await h.openFixture()
  h.key('3', ['control', 'shift'])
  await h.wait(500)
  await h.click('.btn', 'New mission')
  await h.wait(400)
  h.expect(await h.js(`document.querySelector('.path-input input')?.value === ${JSON.stringify(h.fixture)}`), 'folder defaults to the open project')
  await h.setValue('.path-input input', '/no/such/folder')
  h.expect(await h.until(() => h.js(`document.querySelector('.form')?.textContent.includes('Not an existing folder')`), 3000), 'a missing folder is called out')
  await h.setValue('.path-input input', other)
  h.expect(await h.until(() => h.js(`document.querySelector('.form')?.textContent.includes('Not a git repository')`), 3000), 'a plain folder is explained: no worktree')
  await h.setValue('.form select', 'claude', `e.querySelector('option[value=claude]')`)
  await h.setValue('.form textarea', 'Work elsewhere', `e.placeholder.includes('pagination')`)
  await h.wait(300)
  await h.shot('1-other-folder')
  await h.click('.form .btn.primary', 'Launch')
  await h.wait(2000)
  const m = (await h.js(`window.api.store.get('missions')`)).missions[0]
  h.expect(m?.cwd === other && m.root === other && !m.worktree, `mission runs in the picked folder (${m?.cwd})`)
  h.expect(await h.js(`document.querySelector('.view-scroll')?.textContent.includes('Other folders')`), 'listed under Other folders')
  await h.shot('2-listed')
}
