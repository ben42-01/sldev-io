// Board + GitHub: open issues come in as cards (with their labels), a card's factory run opens a PR
// that closes its issue, and once the PR is merged the card moves to Done on its own.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

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

  // pick-up runs the PR recipe
  await h.click('.board-page .btn', 'at a time')
  await h.until(() => h.js(`!!document.querySelector('dialog[open] .board-form')`), 2000)
  await h.click('dialog[open] .board-form .seg button', 'Factory recipe')
  await h.wait(200)
  await h.setValue('dialog[open] .board-form select', 'E2E PR', `[...e.options].some(o => o.value === 'E2E PR')`)
  await h.click('dialog[open] .btn.primary', 'Save')
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
  fs.writeFileSync(path.join(h.fixture, 'pr-state.txt'), 'MERGED')
  await menu('Login button does nothing on Safari', 'Check pull requests now')
  h.expect(await h.until(async () => (await cards('done')).includes('Login button does nothing on Safari'), 8000), 'a merged PR moves its card to Done')
  h.expect(await h.js(`${card('Login button does nothing on Safari')}.textContent.includes('PR #12 merged')`), 'and says so')
  await h.wait(300)
  await h.shot('4-merged')
}

module.exports.env = { FAKE_GH_AUTHED: '1' }
