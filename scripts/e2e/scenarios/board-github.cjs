// Board + GitHub: open issues come in as cards (with their labels), a card's factory run opens a PR
// that closes its issue, and once the PR is merged the card moves to Done on its own. Another card waiting
// in Review on the same base is then flagged to re-check (sharing a file with the merged PR), and the flag
// clears once its branch has the base again.
const fs = require('fs')
const path = require('path')
const { execFileSync, execSync } = require('child_process')

const RECIPE = `name: E2E PR
description: One agent, then a PR.
stages:
  - id: build
    agent: claude
    prompt: Build {intent}
  - id: pr
    pr: { title: "{intent}" }
`

module.exports = async (h) => {
  const origin = path.join(path.dirname(h.fixture), 'origin.git')
  execSync(`git init -q --bare ${JSON.stringify(origin)} && git remote add origin ${JSON.stringify(origin)}`, { cwd: h.fixture })
  fs.mkdirSync(path.join(h.fixture, '.sldev', 'factory'), { recursive: true })
  fs.writeFileSync(path.join(h.fixture, '.sldev', 'factory', 'e2e.yml'), RECIPE)
  await h.openFixture({ rightPanelVisible: false })

  const cards = (column) => h.js(`[...document.querySelectorAll('.board-column[data-column="${column}"] .board-card .board-title')].map(t => t.textContent)`)
  const card = (title) => `[...document.querySelectorAll('.board-card')].find(c => c.querySelector('.board-title')?.textContent === ${JSON.stringify(title)})`
  const menu = async (title, item) => {
    await h.js(`${card(title)}.querySelector('.icon-btn[aria-label="More"]').click()`)
    await h.wait(200)
    return h.click('.ctx-menu .ctx-item', item)
  }
  const runs = () => h.js(`window.api.store.get('factoryRuns').then(s => s.runs)`)

  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Board"]')
  await h.until(() => h.js(`document.querySelectorAll('.board-column').length === 6`), 3000)

  // import (from the Board menu): both open issues are offered, with their labels
  const boardMenu = async (item) => {
    await h.click('.board-head-actions .btn', 'Board')
    await h.wait(200)
    return h.click('.ctx-menu .ctx-item', item)
  }
  await boardMenu('Import GitHub issues')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('dialog[open] .board-import-list li').length === 2`), 5000), 'the import lists the open issues')
  h.expect(await h.js(`[...document.querySelectorAll('dialog[open] .board-import-list li')][0].textContent.includes('bug')`), 'with their labels')
  // only #42, into Agent ready
  await h.js(`[...document.querySelectorAll('dialog[open] .board-import-list li')].find(l => l.textContent.includes('#7')).querySelector('input').click()`)
  await h.setValue('dialog[open] .board-form select', 'ready', `[...e.options].some(o => o.value === 'ready')`)
  await h.wait(200)
  await h.shot('1-import')
  await h.click('dialog[open] .btn.primary', 'Import')
  h.expect(await h.until(async () => (await cards('ready')).includes('Login button does nothing on Safari'), 2000), 'the issue is a card in Agent ready')
  const imported = await h.until(() => h.js(`window.api.store.get('board').then(b => b.items[0])`), 2000)
  h.expect(imported?.issue?.number === 42 && imported.priority === 'high' && imported.labels.join() === 'bug,p1' && imported.body.includes('issues/42'), 'with the issue link, its labels, and P1 as high priority')
  h.expect(await h.js(`${card('Login button does nothing on Safari')}.querySelector('.board-issue')?.textContent.includes('42')`), 'the card shows its issue number')

  // importing again offers it as already on the board
  await boardMenu('Import GitHub issues')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('dialog[open] .board-import-list li')].some(l => l.textContent.includes('on the board') && l.querySelector('input').disabled)`), 5000), 'an imported issue is not offered twice')
  await h.click('dialog[open] .btn.ghost', 'Cancel')

  // a second card runs as a Build mission in a worktree (the board's default work) and waits in Review
  await h.click('[data-column="ready"] .board-add')
  await h.setValue('.board-quick input', 'Add a health check')
  await h.js(`document.querySelector('.board-quick').requestSubmit()`)
  await h.until(async () => (await cards('ready')).includes('Add a health check'), 2000)
  await h.js(`document.querySelector('.board-quick input')?.blur()`)
  await h.js(`${card('Add a health check')}.querySelector('.board-card-foot .btn').click()`)
  h.expect(await h.until(async () => (await cards('review')).includes('Add a health check'), 25000), 'the mission card finishes into Review')
  const health = await h.js(`window.api.store.get('missions').then(s => s.missions.find(m => m.title.includes('Add a health check')))`)
  h.expect(!!health?.worktree?.branch, `it worked in a worktree (${health?.worktree?.path})`)
  // its own PR stays open while the other card's merges
  fs.writeFileSync(path.join(h.fixture, `pr-state-${health.worktree.branch.replace(/\//g, '-')}.txt`), 'OPEN')

  // pick-up runs the PR recipe
  await h.click('.board-page .btn', 'at a time')
  await h.until(() => h.js(`!!document.querySelector('dialog[open] .board-form')`), 2000)
  await h.click('dialog[open] .board-form .seg button', 'Factory recipe')
  await h.wait(200)
  await h.setValue('dialog[open] .board-form select', 'E2E PR', `[...e.options].some(o => o.value === 'E2E PR')`)
  // the health check card waits in Review with its PR open: with Wait until Done (the default) nothing more would
  // start, so this board runs in parallel and takes the next card as soon as an agent finishes
  await h.js(`[...document.querySelectorAll('dialog[open] label.check')].find(l => l.textContent.includes('Wait until Done')).querySelector('input').click()`)
  await h.click('dialog[open] .btn.primary', 'Save')
  h.expect(await h.until(() => h.js(`window.api.store.get('board').then(b => b.settings[0]?.waitForDone === false)`), 2000), 'Wait until Done is off for this board')
  await h.click('.board-page .chip-check input')
  h.expect(await h.until(async () => (await cards('progress')).includes('Login button does nothing on Safari'), 10000), 'pick-up starts the card')
  h.expect(await h.until(async () => (await runs())?.[0]?.issue === 42, 5000), 'its run knows the issue (the PR closes it)')
  h.expect(await h.until(async () => (await runs())?.[0]?.nodes.pr.status === 'approval', 30000), 'the PR step waits for a click')
  h.expect(await h.until(() => h.js(`${card('Login button does nothing on Safari')}?.classList.contains('needs-you')`), 3000), 'the card says it needs you')
  await h.wait(300)
  await h.shot('2-needs-you')

  // the card's status line opens the pipeline; push
  await h.js(`${card('Login button does nothing on Safari')}.querySelector('.board-work').click()`)
  await h.until(() => h.js(`!!document.querySelector('.pipeline-node[data-node="pr"] .btn.primary')`), 3000)
  await h.click('.pipeline-node[data-node="pr"] .btn.primary', 'Push and open PR')
  h.expect(await h.until(async () => (await runs())[0].pr?.number === 12, 10000), 'the run opened PR #12')
  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Board"]')
  h.expect(await h.until(async () => (await cards('review')).includes('Login button does nothing on Safari'), 10000), 'the finished run moves the card to Review')
  h.expect(await h.until(() => h.js(`${card('Login button does nothing on Safari')}.querySelector('.board-work')?.textContent.includes('PR #12')`), 3000), 'its status line names the PR')
  await h.wait(300)
  await h.shot('3-review')

  // the PR gets merged on GitHub: the card moves to Done
  const healthCard = () => h.js(`window.api.store.get('board').then(b => b.items.find(i => i.title === 'Add a health check'))`)
  const before = await healthCard()
  h.expect(!before.baseMoved && !(await h.js(`!!${card('Add a health check')}.querySelector('.board-moved')`)), 'no badge before anything merged')
  // the run's change touches a file the mission's does too
  fs.writeFileSync(path.join((await runs())[0].worktree.path, 'NOTES.md'), '# notes from the run\n')
  fs.writeFileSync(path.join(h.fixture, 'pr-state.txt'), 'MERGED')
  await menu('Login button does nothing on Safari', 'Check pull requests now')
  h.expect(await h.until(async () => (await cards('done')).includes('Login button does nothing on Safari'), 8000), 'a merged PR moves its card to Done')
  h.expect(await h.js(`${card('Login button does nothing on Safari')}.textContent.includes('PR #12 merged')`), 'and says so')
  await h.wait(300)
  await h.shot('4-merged')

  // the other card in Review on the same base is told to re-check, and which file it shares with the merged PR
  h.expect(await h.until(() => h.js(`${card('Add a health check')}?.querySelector('.board-moved.strong')?.textContent.includes('main moved: re-check')`), 8000), 'the card still in Review gets the badge')
  const badge = await h.js(`${card('Add a health check')}.querySelector('.board-moved').textContent`)
  h.expect(badge.includes('shares 1 file with #1'), `it says it shares a file with the merged card (${badge})`)
  h.expect(await h.js(`${card('Add a health check')}.querySelector('.board-moved').title.includes('NOTES.md')`), 'and names the file')
  const flagged = await healthCard()
  h.expect(flagged.baseMoved?.files?.join() === 'NOTES.md' && flagged.updatedAt === before.updatedAt, 'the flag is local: the card itself is not changed (no updatedAt bump)')
  h.expect(!(await cards('done')).includes('Add a health check'), 'its own open PR keeps it in Review')
  await h.js(`${card('Add a health check')}.querySelector('.board-moved').scrollIntoView({ block: 'center' })`)
  await h.wait(500)
  await h.shot('5-base-moved')

  // its menu offers the re-check, which opens the mission's Review tab
  await menu('Add a health check', 'main moved: re-check')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.dv-tab')].some(t => t.textContent.includes('Review: ') && t.textContent.includes('health check'))`), 5000), 'the re-check opens the Review tab')
  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Board"]')
  await h.until(() => h.js(`!!${card('Add a health check')}`), 3000)

  // looking again before the branch changed keeps the badge
  await boardMenu('Check pull requests now')
  await h.wait(1500)
  h.expect(await h.js(`!!${card('Add a health check')}.querySelector('.board-moved')`), 'the badge stays until the branch is updated')

  // the merge lands on main, and the branch is updated with it (as Update and check does): the badge clears
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'e2e', GIT_AUTHOR_EMAIL: 'e2e@e', GIT_COMMITTER_NAME: 'e2e', GIT_COMMITTER_EMAIL: 'e2e@e' } })
  fs.writeFileSync(path.join(h.fixture, 'MERGED.md'), 'from PR #12\n')
  git(h.fixture, 'add', 'MERGED.md')
  git(h.fixture, 'commit', '-q', '-m', 'Login button fix (#12)')
  git(health.worktree.path, 'add', '-A')
  git(health.worktree.path, 'commit', '-q', '-m', 'Add a health check')
  await boardMenu('Check pull requests now')
  await h.wait(1500)
  h.expect(await h.js(`!!${card('Add a health check')}.querySelector('.board-moved')`), 'a new commit while still behind main keeps the badge')
  git(health.worktree.path, 'merge', '-q', '--no-edit', 'main')
  await boardMenu('Check pull requests now')
  h.expect(await h.until(() => h.js(`!${card('Add a health check')}.querySelector('.board-moved')`), 8000), 'the badge clears once the branch has main again')
  h.expect(await h.until(async () => !(await healthCard()).baseMoved, 3000), 'and the flag is gone from the card')
  await h.wait(300)
  await h.shot('6-rechecked')
}

module.exports.env = { FAKE_GH_AUTHED: '1' }
