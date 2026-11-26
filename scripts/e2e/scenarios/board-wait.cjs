// Board pick-up, one at a time: card A finishes into Review and card B stays in Agent ready while A's PR is open
// (wait until Done). Once A's PR merges on the remote, A moves to Done, B starts, and B's worktree is branched from
// the freshly fetched default branch, so it has A's commit, even though the main checkout sits on another branch
// and its local main is behind.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

module.exports = async (h) => {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'e2e', GIT_AUTHOR_EMAIL: 'e2e@e', GIT_COMMITTER_NAME: 'e2e', GIT_COMMITTER_EMAIL: 'e2e@e' }
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' }).trim()
  const origin = path.join(path.dirname(h.fixture), 'origin.git')
  g(path.dirname(h.fixture), 'init', '-q', '--bare', '-b', 'main', origin)
  g(h.fixture, 'remote', 'add', 'origin', origin)
  g(h.fixture, 'push', '-q', '-u', 'origin', 'main')
  g(h.fixture, 'remote', 'set-head', 'origin', 'main')
  // the main checkout is on someone's feature branch: pick-up must not branch from it
  g(h.fixture, 'checkout', '-q', '-b', 'someones-feature')
  fs.writeFileSync(path.join(h.fixture, 'FEATURE.md'), 'not merged anywhere\n')
  g(h.fixture, 'add', 'FEATURE.md')
  g(h.fixture, 'commit', '-q', '-m', 'unmerged feature work')

  await h.openFixture({ rightPanelVisible: false })
  const cards = (column) => h.js(`[...document.querySelectorAll('.board-column[data-column="${column}"] .board-card .board-title')].map(t => t.textContent)`)
  const stored = async (title) => (await h.js(`window.api.store.get('board')`)).items.find((i) => i.title === title)
  const missionOf = (title) => h.js(`window.api.store.get('missions').then(s => s.missions.find(m => m.title.includes(${JSON.stringify(title)})))`)

  await h.click('.activitybar:not(.right) .activity-btn[aria-label^="Board"]')
  await h.until(() => h.js(`document.querySelectorAll('.board-column').length === 6`), 3000)
  for (const title of ['Card A', 'Card B']) {
    await h.click('[data-column="ready"] .board-add')
    await h.setValue('.board-quick input', title)
    await h.js(`document.querySelector('.board-quick').requestSubmit()`)
    await h.until(async () => (await cards('ready')).includes(title), 2000)
  }
  await h.js(`document.querySelector('.board-quick input')?.blur()`)

  // the pick-up dialog has the new settings, on by default
  await h.click('.board-page .btn', 'at a time')
  await h.until(() => h.js(`!!document.querySelector('dialog[open] .board-form')`), 2000)
  h.expect(await h.js(`[...document.querySelectorAll('dialog[open] label.check')].some(l => l.textContent.includes('Wait until Done') && l.querySelector('input').checked)`), 'Wait until Done is on by default')
  await h.shot('0-settings')
  await h.click('dialog[open] .btn.ghost', 'Cancel')

  await h.click('.board-page .chip-check input')
  h.expect(await h.until(async () => (await cards('progress')).includes('Card A'), 10000), 'pick-up starts card A')
  h.expect((await cards('ready')).includes('Card B'), 'one at a time: B waits')
  h.expect(await h.until(async () => (await cards('review')).includes('Card A'), 30000), 'A finishes into Review')
  const a = await missionOf('Card A')
  h.expect(a?.worktree?.base === 'main', `A branched from main, not the checkout's feature branch (${a?.worktree?.base})`)
  h.expect(!fs.existsSync(path.join(a.worktree.path, 'FEATURE.md')), "A's worktree doesn't have the unmerged feature work")
  h.expect(!!(await stored('Card A')).started?.base, 'the card records the base commit it started from')
  await h.wait(4000)
  h.expect((await cards('ready')).includes('Card B'), 'A in Review with its PR open: B still waits')
  await h.shot('1-a-in-review')

  // A's PR merges on GitHub: its commit lands on origin/main (local main stays behind)
  fs.writeFileSync(path.join(a.worktree.path, 'A.md'), 'from card A\n')
  g(a.worktree.path, 'add', '-A')
  g(a.worktree.path, 'commit', '-q', '-m', 'Card A')
  const aCommit = g(a.worktree.path, 'rev-parse', 'HEAD')
  g(a.worktree.path, 'push', '-q', 'origin', 'HEAD:main')
  fs.writeFileSync(path.join(h.fixture, `pr-state-${a.worktree.branch.replace(/\//g, '-')}.txt`), 'MERGED')
  await h.click('.board-head-actions .btn', 'Board')
  await h.wait(200)
  await h.click('.ctx-menu .ctx-item', 'Check pull requests now')
  h.expect(await h.until(async () => (await cards('done')).includes('Card A'), 10000), "A's merged PR moves it to Done")
  h.expect(await h.until(async () => !(await cards('ready')).includes('Card B'), 10000), 'then B is picked up')
  const b = await h.until(async () => (await missionOf('Card B'))?.worktree?.path && (await missionOf('Card B')), 10000)
  h.expect(b?.worktree?.base === 'origin/main', `B starts from the fetched origin/main, local main being behind (${b?.worktree?.base})`)
  h.expect(g(h.fixture, 'merge-base', '--is-ancestor', aCommit, g(b.worktree.path, 'rev-parse', 'HEAD')) === '', "B's worktree has A's commit")
  h.expect(fs.existsSync(path.join(b.worktree.path, 'A.md')), "and A's file")
  h.expect(g(h.fixture, 'rev-parse', '--abbrev-ref', 'HEAD') === 'someones-feature', 'the main checkout is left on its branch')
  h.expect(await h.until(async () => (await cards('review')).includes('Card B'), 30000), 'B finishes into Review')
  await h.wait(300)
  await h.shot('2-b-from-a')
}

module.exports.env = { FAKE_GH_AUTHED: '1' }
