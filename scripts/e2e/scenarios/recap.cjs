// Recap: Mission Control's Recap menu turns the missions into a standup as Markdown, to copy or keep as a note.

module.exports = async (h) => {
  const now = Date.now()
  const min = 60000
  const mission = (id, title, ago, extra = {}) => ({
    id, title, prompt: title, root: h.fixture, cwd: h.fixture, options: { agent: 'claude' }, status: 'ended',
    createdAt: now - ago - 40 * min, updatedAt: now - ago,
    history: [{ status: 'working', at: now - ago - 40 * min }, { status: 'ended', at: now - ago }], ...extra
  })
  const seeded = [
    mission('r1', 'Add rate limiting to the API', 30 * min, {
      report: 'Done!\n\nAdded a token bucket in front of /api and a test for the 429 path.',
      worktree: { path: h.fixture, branch: 'feature/rate-limit', base: 'main', repo: h.fixture },
      stats: { files: 4, insertions: 120, deletions: 12 }
    }),
    mission('r2', 'Research: why is checkout slow', 90 * min, { kind: { id: 'research', name: 'Research', readOnly: true }, report: 'Checkout waits on three sequential price lookups.' }),
    mission('r3', 'Fix flaky login test', 120 * min, { status: 'failed', options: { agent: 'codex' } }),
    // last month: never in a standup
    mission('r5', 'Old work', 40 * 24 * 60 * min)
  ]
  await h.js(`window.api.store.set('missions', ${JSON.stringify({ missions: seeded })})`)
  await h.openFixture({ rightPanelVisible: false })

  // one live mission: the fake claude finishes its turn and waits for review
  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Mission Control"]')
  await h.until(() => h.js(`!!document.querySelector('.mc')`), 3000)
  await h.click('.mc .btn.primary', 'New mission')
  await h.until(() => h.js(`!!document.querySelector('dialog[open] .mission-form')`), 2000)
  await h.setValue('dialog[open] .form textarea', 'Upgrade the router')
  await h.wait(200)
  await h.click('dialog[open] .form .btn.primary', 'Launch')
  const status = () => h.js(`window.api.store.get('missions').then(s => s.missions.find(m => m.title === 'Upgrade the router')?.status)`)
  h.expect(await h.until(async () => (await status()) === 'waiting', 12000), 'a live mission reaches Ready')

  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Mission Control"]')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.mc')`), 3000), 'Mission Control opens')
  await h.click('.mc .btn', 'Recap')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.ctx-menu .ctx-item').length === 3`), 2000), 'Recap opens a menu of three periods')
  await h.wait(200)
  await h.shot('1-menu')
  await h.click('.ctx-menu .ctx-item', 'Standup')
  h.expect(await h.until(() => h.js(`!!document.querySelector('dialog[open] .recap')`), 2000), 'the recap dialog opens')

  const md = () => h.js(`document.querySelector('dialog[open] .recap-md')?.textContent ?? ''`)
  const text = await md()
  h.log(text)
  h.expect(text.includes('## Standup: project'), 'it is headed with the period and the project')
  h.expect(text.includes('### Done\n- Add rate limiting to the API (Claude Code, `feature/rate-limit`, +120 −12)\n  Added a token bucket in front of /api'), 'done work with its branch, diff and report line')
  h.expect(text.includes('- Research: why is checkout slow (Claude Code)') && !text.includes('Research: Research'), 'research is named once')
  h.expect(text.includes('### Ready for review\n- Upgrade the router (Claude Code'), 'a mission waiting for review has its own group')
  h.expect(text.includes('### Blocked / needs attention\n- Fix flaky login test (Codex, failed)'), 'a failed mission is listed as blocked')
  h.expect(!text.includes('Old work'), 'last month is left out')
  h.expect(await h.js(`document.querySelector('.recap-tile[data-group="done"] .recap-num')?.textContent === '2' && document.querySelector('.recap-tile[data-group="review"] .recap-num')?.textContent === '1'`), 'the tiles count each group')
  await h.wait(300)
  await h.shot('2-standup')

  await h.click('dialog[open] .recap .check input')
  h.expect(await h.until(async () => !(await md()).includes('token bucket'), 1500), 'report lines can be left out')
  await h.click('dialog[open] .recap .seg button', 'This week')
  h.expect(await h.until(async () => (await md()).startsWith('## This week: project'), 1500), 'the period can be switched in the dialog')

  await h.click('dialog[open] .btn.primary', 'Copy Markdown')
  h.expect(await h.until(async () => (await h.js('window.api.clipboard.readText()')).startsWith('## This week: project'), 2000), 'Copy puts the Markdown on the clipboard')
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open] .btn.primary')?.textContent.includes('Copied')`), 1000), 'and the button says so')
  await h.shot('3-copied')

  await h.click('dialog[open] .btn', 'Save as note')
  h.expect(await h.until(() => h.js(`!document.querySelector('dialog[open]') && [...document.querySelectorAll('.dv-tab')].some(t => t.textContent.includes('This week'))`), 4000), 'Save as note opens it as a note')
  h.expect(await h.until(async () => (await h.js(`window.api.notes.list(${JSON.stringify(h.fixture)})`)).some((n) => n.title.startsWith('This week')), 2000), 'the note is in the project notes')
  await h.wait(500)
  await h.shot('4-note')

  // the palette has it too
  h.key('P', ['control', 'shift'])
  await h.wait(300)
  await h.type('recap standup')
  await h.wait(200)
  await h.key('Enter')
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open] .recap .seg button.on')?.textContent === 'Standup'`), 2000), 'the palette opens the standup recap')
  await h.key('Escape')
}
