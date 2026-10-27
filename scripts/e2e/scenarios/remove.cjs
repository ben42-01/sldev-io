// Removing a mission asks first: blocked while the agent runs, and a worktree with uncommitted work
// is only removed after "discard" is ticked (it used to be one click with git worktree remove --force).
const fs = require('fs')

const dialog = (h) => h.js(`document.querySelector('dialog[open]')?.textContent ?? ''`)
const confirmDisabled = (h) => h.js(`[...document.querySelectorAll('dialog[open] .btn')].find(b => b.textContent.includes('Confirm remove'))?.disabled`)
const openRemove = async (h) => {
  await h.click('.mission-card .icon-btn[title=More]')
  await h.wait(200)
  await h.click('.ctx-item', 'Remove mission and worktree')
  await h.until(async () => (await dialog(h)).includes('Remove this mission'), 5000)
}

module.exports = async (h) => {
  await h.openFixture()
  h.key('3', ['control', 'shift'])
  await h.wait(500)
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.setValue('.form select', 'claude', `e.querySelector('option[value=claude]')`)
  await h.setValue('.form textarea', 'Remove me later')
  await h.click('.form .btn.primary', 'Launch')
  h.expect(await h.until(async () => (await h.js(`document.querySelector('.mission-card')?.textContent ?? ''`)).includes('Ready for you'), 15000), 'mission ran and is ready')

  await openRemove(h)
  h.expect((await dialog(h)).includes('still running here'), 'blocked while the agent runs')
  h.expect(await confirmDisabled(h), 'confirm disabled while blocked')
  await h.shot('1-blocked')
  await h.click('dialog[open] .btn', 'Keep mission')
  await h.wait(300)

  await h.click('.mission-card .icon-btn[title=Stop]')
  h.expect(await h.until(async () => !(await h.js(`!!document.querySelector('.mission-card .icon-btn[title=Stop]')`)), 8000), 'agent stopped')

  await openRemove(h)
  const text = await dialog(h)
  const wt = await h.js(`[...document.querySelectorAll('dialog[open] code')].map(c => c.textContent).find(t => t.includes('.sldev-worktrees'))`)
  h.expect(/Discard .*modified file|Discard .*untracked file/.test(text), `asks to discard the uncommitted work (${text.slice(0, 200)})`)
  h.expect(await confirmDisabled(h), 'confirm disabled until discard is ticked')
  h.expect(!!wt && fs.existsSync(wt), 'shows the worktree path, which exists')
  await h.shot('2-needs-discard')
  await h.js(`[...document.querySelectorAll('dialog[open] label.check')].find(l => l.textContent.includes('Discard')).querySelector('input').click()`)
  await h.wait(200)
  h.expect(!(await confirmDisabled(h)), 'confirm enabled after ticking discard')
  await h.click('dialog[open] .btn', 'Confirm remove')
  h.expect(await h.until(async () => !fs.existsSync(wt), 8000), 'worktree removed')
  h.expect(await h.until(async () => !(await h.js(`!!document.querySelector('.mission-card')`)), 4000), 'mission gone from the list')
  await h.shot('3-removed')
}
