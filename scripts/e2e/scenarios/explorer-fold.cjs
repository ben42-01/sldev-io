// The Explorer's project name folds the whole tree and unfolds it again, with the folders that were open
// inside still open.
module.exports = async (h) => {
  await h.openFixture({ sidebarVisible: true, activeView: 'explorer' })
  const rows = () => h.js(`document.querySelectorAll('.tree .tree-row').length`)
  h.expect(await h.until(async () => (await rows()) > 0, 5000), 'the tree shows the project')
  // open the first folder inside, so unfolding can show it was kept open
  await h.js(`[...document.querySelectorAll('.tree .tree-row')].find((r) => r.querySelector('.ic-folder'))?.click()`)
  await h.wait(400)
  const before = await rows()
  await h.shot('0-open')

  await h.click('.sidebar-root')
  h.expect(await h.until(async () => (await rows()) === 0, 3000), 'clicking the project name folds the tree')
  h.expect(await h.js(`document.querySelector('.sidebar-root')?.getAttribute('aria-expanded') === 'false'`), 'and says it is folded')
  await h.wait(200)
  await h.shot('1-folded')

  await h.click('.sidebar-root')
  h.expect(await h.until(async () => (await rows()) === before, 3000), `unfolding shows it as it was, open folders included (${before} rows)`)
  await h.shot('2-unfolded')
}
