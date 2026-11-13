// Board cleanup: a card that ran as a mission (no factory run, so no PR recorded) moves to Done once the
// PR from its worktree branch is merged; the board fills its tab, columns scroll their own cards; and
// Clear Done deletes every Done card with its worktree and local branch, after asking.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

module.exports = async (h) => {
  await h.openFixture({ rightPanelVisible: false })
  const cards = (column) => h.js(`[...document.querySelectorAll('.board-column[data-column="${column}"] .board-card .board-title')].map(t => t.textContent)`)
  const card = (title) => `[...document.querySelectorAll('.board-card')].find(c => c.querySelector('.board-title')?.textContent === ${JSON.stringify(title)})`
  const boardMenu = async (item) => {
    await h.click('.board-head-actions .btn', 'Board')
    await h.wait(200)
    return h.click('.ctx-menu .ctx-item', item)
  }
  const missionOf = () => h.js(`window.api.store.get('missions').then(s => s.missions.find(m => m.title.includes('Add a health check')))`)

  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Board"]')
  await h.until(() => h.js(`document.querySelectorAll('.board-column').length === 6`), 3000)

  // the board fills the tab: the page itself doesn't scroll, the columns end at the bottom of the tab
  const fills = await h.js(`(() => { const p = document.querySelector('.board-page'), c = document.querySelector('.board-columns'); return { page: p.scrollHeight <= p.clientHeight + 1, gap: p.getBoundingClientRect().bottom - c.getBoundingClientRect().bottom } })()`)
  h.expect(fills.page && fills.gap < 40, `the columns fill the tab (${JSON.stringify(fills)})`)

  // lots of backlog: the column scrolls its own cards, the page stays put
  await h.click('[data-column="backlog"] .board-add')
  for (let n = 1; n <= 14; n++) {
    await h.setValue('.board-quick input', `Idea ${n}`)
    await h.js(`document.querySelector('.board-quick').requestSubmit()`)
    await h.wait(60)
  }
  await h.js(`document.querySelector('.board-quick input')?.blur()`)
  h.expect(await h.until(async () => (await cards('backlog')).length === 14, 3000), 'fourteen backlog cards')
  h.expect(await h.js(`(() => { const b = document.querySelector('[data-column="backlog"] .board-column-body'), p = document.querySelector('.board-page'); return b.scrollHeight > b.clientHeight && p.scrollHeight <= p.clientHeight + 1 })()`), 'the Backlog column scrolls on its own, the page does not')
  await h.shot('1-full-height')

  // a card runs as a Build mission in a worktree and finishes into Review
  await h.click('[data-column="ready"] .board-add')
  await h.setValue('.board-quick input', 'Add a health check')
  await h.js(`document.querySelector('.board-quick').requestSubmit()`)
  await h.until(async () => (await cards('ready')).includes('Add a health check'), 2000)
  await h.js(`${card('Add a health check')}.querySelector('.board-card-foot .btn').click()`)
  h.expect(await h.until(async () => (await cards('review')).includes('Add a health check'), 25000), 'the mission finishes and the card is in Review')
  const m = await missionOf()
  h.expect(!!m?.worktree?.branch && fs.existsSync(m.worktree.path), `the card's mission worked in a worktree (${m?.worktree?.path})`)

  // its PR (found by the branch) is merged: the card moves to Done
  fs.writeFileSync(path.join(h.fixture, 'pr-state.txt'), 'MERGED')
  await boardMenu('Check pull requests now')
  h.expect(await h.until(async () => (await cards('done')).includes('Add a health check'), 8000), 'a merged PR from the mission branch moves the card to Done')
  h.expect(await h.js(`${card('Add a health check')}.textContent.includes('PR #21 merged')`), 'and says which PR')
  await h.wait(300)
  await h.shot('2-merged')

  // Clear Done: asks, says what goes, deletes the card, its worktree and its local branch
  await h.click('[data-column="done"] .icon-btn[aria-label="Clear Done"]')
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open] .modal-title')?.textContent === 'Clear Done?'`), 3000), 'Clear Done asks first')
  h.expect(await h.js(`document.querySelector('dialog[open]').textContent.includes(${JSON.stringify(m.worktree.path)})`), 'naming the worktree it removes')
  h.expect(await h.js(`[...document.querySelectorAll('dialog[open] input[type=checkbox]')].some(c => c.checked)`), 'deleting the local branch is ticked for Done')
  h.expect(await h.js(`document.querySelector('dialog[open]').textContent.includes('idle agent session') && !document.querySelector('dialog[open] .banner.tone-error')`), 'an agent idle at its prompt is ended, not a blocker')
  // the fake agent left uncommitted files: confirming needs "discard" ticked
  await h.js(`[...document.querySelectorAll('dialog[open] label')].find(l => l.textContent.includes('Discard'))?.querySelector('input').click()`)
  await h.wait(200)
  await h.shot('3-confirm')
  await h.click('dialog[open] .btn.danger-solid', 'Clear 1 card')
  h.expect(await h.until(async () => !(await cards('done')).length, 6000), 'Done is empty')
  h.expect(await h.until(() => !fs.existsSync(m.worktree.path), 4000), 'the worktree folder is gone')
  const branches = execFileSync('git', ['branch', '--list', m.worktree.branch], { cwd: h.fixture, encoding: 'utf8' })
  h.expect(!branches.trim(), 'and its local branch')
  h.expect(await h.until(async () => !(await missionOf()), 3000), 'and its mission left the list')
  h.expect((await cards('backlog')).length === 14, 'other columns are untouched')

  // Clear Backlog from the Board menu: cards without work, nothing else to remove
  await boardMenu('Clear Backlog')
  await h.until(() => h.js(`document.querySelector('dialog[open] .modal-title')?.textContent === 'Clear Backlog?'`), 3000)
  await h.click('dialog[open] .btn.danger-solid', 'Clear 14 cards')
  h.expect(await h.until(async () => !(await cards('backlog')).length, 4000), 'Clear Backlog empties it')
  await h.shot('4-cleared')
}
