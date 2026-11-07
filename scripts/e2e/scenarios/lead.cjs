// Lead: a mission that plans and delegates. The fake Lead starts two workers (Claude and Codex) with
// sldev_delegate; they run unattended in worktrees branched from the Lead's; sldev_wait brings their
// reports back; sldev_integrate merges both branches into the Lead's and runs a check. Workers show
// inside the Lead's card in Mission Control, and a Board card can start with a Lead.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

module.exports = async (h) => {
  await h.openFixture({ rightPanelVisible: false })
  const store = (k) => h.js(`window.api.store.get('${k}')`)

  // a Board card starts with a Lead
  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Board"]')
  await h.until(() => h.js(`document.querySelectorAll('.board-column').length === 6`), 3000)
  await h.click('[data-column="backlog"] .board-add')
  await h.wait(200)
  await h.setValue('.board-quick input', 'Ship the release notes')
  await h.js(`document.querySelector('.board-quick').requestSubmit()`)
  await h.key('Escape')
  const card = `[...document.querySelectorAll('.board-card')].find(c => c.querySelector('.board-title')?.textContent === 'Ship the release notes')`
  await h.until(() => h.js(`!!${card}`), 2000)
  await h.js(`${card}.querySelector('.icon-btn[aria-label="More"]').click()`)
  await h.wait(200)
  await h.click('.ctx-menu .ctx-item', 'Start with a Lead')

  const lead = await h.until(async () => (await store('missions')).missions.find((m) => m.kind?.id === 'lead'), 8000)
  h.expect(!!lead && !!lead.worktree && lead.lead?.maxWorkers === 6 && lead.prompt.startsWith('Lead: #1 Ship the release notes') && lead.prompt.includes('sldev_delegate'), 'the Lead mission starts in its own worktree, with its limits and method')

  const workers = async () => (await store('missions')).missions.filter((m) => m.delegate?.lead === lead.id)
  h.expect(await h.until(async () => (await workers()).length === 2, 20000), 'it delegates two tasks')
  const ws = await workers()
  const claude = ws.find((w) => w.options.agent === 'claude')
  const codex = ws.find((w) => w.options.agent === 'codex')
  h.expect(!!claude && !!codex && ws.every((w) => w.options.print && w.worktree && w.worktree.path !== lead.worktree.path), 'to Claude and Codex, unattended, each in its own worktree')
  h.expect(ws.every((w) => w.worktree.base === lead.worktree.branch), "branched from the Lead's branch")
  h.expect(claude.brief.includes('Acceptance criteria:\n- CHANGES.md says what changed') && claude.brief.includes('one part of a bigger goal'), 'a worker gets its task, criteria and the bigger goal')
  h.expect(claude.delegate.why === 'chosen by the Lead', 'and why it was chosen')

  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Mission Control"]')
  await h.until(() => h.js(`!!document.querySelector('.mc')`), 3000)
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.mission-card .lead-worker').length === 2`), 5000), "the workers show inside the Lead's card")
  h.expect(!(await h.js(`[...document.querySelectorAll('.mission-card > .mission-title')].some(t => t.textContent === 'Codex part')`)), 'not as missions of their own')
  await h.wait(400)
  await h.shot('1-delegating')

  h.expect(await h.until(async () => (await workers()).every((w) => w.delegate?.merged), 90000), 'both branches are merged into the Lead')
  h.expect(fs.existsSync(path.join(lead.worktree.path, 'CHANGES.md')) && fs.existsSync(path.join(lead.worktree.path, 'CODEX.md')), "the Lead's branch has both workers' work")
  h.expect(!fs.existsSync(path.join(h.fixture, 'CODEX.md')), 'and the project itself is untouched')
  const log = execSync('git log --oneline', { cwd: lead.worktree.path, encoding: 'utf8' })
  h.expect(/Merge branch/.test(log), 'merged as commits in the Lead branch')
  const done = await h.until(async () => (await store('missions')).missions.find((m) => m.id === lead.id && m.report), 20000)
  h.expect(!!done && done.report.includes('2 workers') && done.report.includes('passed'), `the Lead reports with the check result (${done?.report ?? ''})`)
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.mission-card .lead-merged').length === 2`), 5000), 'the card marks both as merged')
  await h.wait(400)
  await h.shot('2-integrated')

  // the board card follows its Lead to Review
  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Board"]')
  h.expect(await h.until(() => h.js(`!!document.querySelector('[data-column="review"] .board-card')`), 15000), 'the board card moves to Review when the Lead is done')
}
