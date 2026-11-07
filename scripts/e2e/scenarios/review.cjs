// Save a mission for later, edit and launch it from the list, then review its changes in a tab of its
// own: side by side, sidebars out of the way, one file's diff opened in the editor (a fake `code`).
const fs = require('fs')
const path = require('path')

module.exports = async (h) => {
  await h.openFixture({ preferredEditor: 'vscode', rightPanelVisible: true })
  h.key('3', ['control', 'shift'])
  await h.wait(500)

  // write a brief, save it instead of launching
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.setValue('.form textarea', 'Make the greeting friendlier')
  await h.wait(200)
  await h.wait(800)
  await h.shot('0-form-save')
  await h.click('.form .btn', 'Save for later')
  await h.wait(600)
  const saved = () => h.js(`window.api.store.get('savedMissions').then(s => s.saved)`)
  h.expect((await saved()).length === 1 && (await saved())[0].brief === 'Make the greeting friendlier', 'the mission is saved, not launched')
  h.expect((await h.js(`window.api.store.get('missions')`)).missions.length === 0, 'nothing started')
  h.expect(await h.js(`!!document.querySelector('.mission-row.saved')`), 'it is listed under Saved for later')
  await h.wait(800)
  await h.shot('1-saved-list')

  // reopen it from the list: the form starts from what was saved
  await h.click('.mission-row.saved .mission-title')
  await h.wait(500)
  h.expect(await h.js(`document.querySelector('.form textarea').value === 'Make the greeting friendlier'`), 'editing starts from the saved brief')
  h.expect(await h.js(`[...document.querySelectorAll('dialog h2, dialog .modal-title, dialog header')].some(e => e.textContent.includes('Saved mission'))`), 'the dialog says it is a saved mission')
  await h.setValue('.form input[maxlength="120"]', 'Friendlier greeting')
  await h.click('.form .btn', 'Save changes')
  await h.wait(500)
  h.expect((await saved())[0]?.title === 'Friendlier greeting' && (await saved()).length === 1, 'saving again updates it in place')

  // launch straight from the row
  await h.click('.mission-row.saved .btn', 'Launch')
  const missions = () => h.js(`window.api.store.get('missions').then(s => s.missions)`)
  h.expect(await h.until(async () => (await missions()).length === 1, 15000), 'Launch starts the mission')
  h.expect(await h.until(async () => (await saved()).length === 0, 3000), 'and it leaves the saved list')
  const m = (await missions())[0]
  h.expect(m.title === 'Friendlier greeting' && !!m.worktree, 'it runs as saved: title and worktree')
  await h.until(async () => (await missions())[0]?.status === 'waiting', 30000)

  // a modified file as well as the agent's new one, so the split view has both sides
  fs.writeFileSync(path.join(m.cwd, 'src/app.js'), "console.log('hello there, friend')\nconsole.log('bye')\n")

  // review: its own tab, sidebars hidden, side by side
  await h.js(`(document.querySelector('.mission-card .next-step') ?? document.querySelector('.mission-card [aria-label="Review changes"]'))?.click()`)
  // it opens on the walkthrough (review-cockpit.cjs); this checks the plain file list
  await h.until(() => h.js(`!!document.querySelector('.diff-toolbar')`), 8000)
  await h.click('.diff-toolbar .seg button', 'All files')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.diff-section').length >= 2`), 8000), 'the review lists the changed files')
  h.expect(await h.js(`document.querySelector('.app').classList.contains('focus-review') && !document.querySelector('.main > .sidebar:not([style*="display: none"])')?.offsetWidth`), 'the sidebars step aside while reviewing')
  h.expect(await h.js(`!!document.querySelector('.diff-table.split td.code.del') && !!document.querySelector('.diff-table.split td.code.add')`), 'old and new lines sit side by side')
  await h.wait(800)
  await h.shot('2-review-split')

  await h.click('.diff-toolbar .seg button', 'Unified')
  await h.wait(300)
  h.expect(await h.js(`!document.querySelector('.diff-table.split') && !!document.querySelector('.diff-table tr.add')`), 'unified view is one column')
  await h.wait(800)
  await h.shot('3-review-unified')

  // the file's diff in the editor: the base version on the left, the worktree file on the right
  await h.js(`[...document.querySelectorAll('.diff-section')].find(s => s.dataset.file === 'src/app.js')?.querySelector('.diff-file-head .btn')?.click()`)
  const log = path.join(path.dirname(h.fixture), 'code.log')
  h.expect(await h.until(() => fs.existsSync(log), 5000), 'the editor was started')
  const args = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split(' ') : []
  h.expect(args[0] === '--diff' && args[2] === path.join(m.cwd, 'src/app.js'), `it gets --diff base file (${args.join(' ')})`)
  h.expect(args[1] && fs.readFileSync(args[1], 'utf8') === "console.log('hello')\n", 'the left side is the file as it was at the base')

  // asking for a sidebar while reviewing shows it, rather than doing nothing behind the focus
  await h.js(`document.querySelector('.activity-btn[aria-label^="Explorer"]')?.click()`)
  await h.wait(400)
  h.expect(await h.js(`!document.querySelector('.app').classList.contains('focus-review') && !!document.querySelector('.main > .sidebar')?.offsetWidth`), 'an activity bar click brings a sidebar back during review')
  // viewed files fold away; focus off brings the sidebars back
  await h.js(`document.querySelector('.diff-viewed input')?.click()`)
  await h.wait(200)
  h.expect(await h.js(`document.querySelector('.diff-file-item.viewed') !== null`), 'a viewed file is marked in the list')
  await h.click('.diff-toolbar .icon-btn[aria-pressed="true"]')
  await h.wait(400)
  h.expect(await h.js(`!document.querySelector('.app').classList.contains('focus-review') && !!document.querySelector('.main > .sidebar')?.offsetWidth`), 'focus off: the sidebars are back')
  await h.wait(800)
  await h.shot('4-review-sidebars')

  // focus mode from anywhere: both sidebars go, and come back on the second press
  h.key('f', ['control', 'alt'])
  await h.wait(400)
  h.expect(await h.js(`!document.querySelector('.main > .sidebar')`), 'Ctrl+Alt+F hides both sidebars')
  h.key('f', ['control', 'alt'])
  await h.wait(400)
  h.expect(await h.js(`document.querySelectorAll('.main > .sidebar').length === 2`), 'and brings them back')

  // two splits: each group can be maximized and restored
  await h.click('.group-actions [aria-label="Split right"]')
  await h.wait(800)
  h.expect(await h.js(`!!document.querySelector('.group-actions [aria-label="Maximize this split"]')`), 'a split offers maximize')
  await h.click('.group-actions [aria-label="Maximize this split"]')
  await h.wait(500)
  h.expect(await h.js(`!!document.querySelector('.group-actions [aria-label="Restore the other splits"]')`), 'and restore once maximized')
  await h.wait(500)
  await h.shot('5-maximized-split')
}
