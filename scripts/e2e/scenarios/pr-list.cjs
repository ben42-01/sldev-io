// The Workflows tab's Pull requests section: closed, nothing is asked; open, the fake gh's two PRs are listed in
// review order (the one asking e2e for a review first), with author, draft, size, age, review decision and a dot for
// the CI on each head commit (#128 failed on its head; #131 has a green run only on an older commit, so none). A click
// opens a Review tab "#<n> <title>" with the PR's diff (nothing checked out: that waits for an action that needs it); again, the same tab comes forward.
// The palette's "Review a pull request…" opens the other one. Closing the section stops the asking.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

module.exports = async (h) => {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'e2e', GIT_AUTHOR_EMAIL: 'e2e@example.com', GIT_COMMITTER_NAME: 'e2e', GIT_COMMITTER_EMAIL: 'e2e@example.com' }
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' }).trim()
  const tmp = path.dirname(h.fixture)
  const origin = path.join(tmp, 'origin.git')
  const fork = path.join(tmp, 'fork')
  g(tmp, 'init', '-q', '--bare', '-b', 'main', origin)
  g(h.fixture, 'remote', 'add', 'origin', origin)
  g(h.fixture, 'push', '-q', '-u', 'origin', 'main')
  g(tmp, 'clone', '-q', origin, fork)
  const prCommit = (n, file) => {
    fs.writeFileSync(path.join(fork, file), `${file}\n`)
    g(fork, 'add', file)
    g(fork, 'commit', '-q', '-m', file)
    const sha = g(fork, 'rev-parse', 'HEAD')
    g(fork, 'push', '-q', '--force', origin, `${sha}:refs/pull/${n}/head`)
    process.env[`FAKE_GH_PR_${n}_HEAD`] = sha
  }
  g(fork, 'checkout', '-q', '-b', 'rate-limit')
  prCommit(128, 'limiter.js')
  g(fork, 'checkout', '-q', '-b', 'cache', 'main')
  prCommit(131, 'cache.js')

  const log = path.join(tmp, 'gh-calls.log')
  process.env.FAKE_GH_LOG = log
  const asked = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter((l) => /^pr list --state open|^api user|^run list --limit 100 /.test(l)).length : 0)

  // focus off: the right panel stays next to the Review tab, so the row can be clicked again
  await h.openFixture({ rightPanelVisible: true, rightPanelTab: 'workflows', rightPanelWidth: 380, reviewFocus: false })
  h.expect(await h.until(() => h.js(`!!document.querySelector('.wf-section.prs .wf-section-header')`), 8000), 'a Pull requests section')
  h.expect(await h.js(`!document.querySelector('.wf-section.prs .wf-section-body')`), 'it starts closed')
  await h.wait(1500)
  h.expect(asked() === 0, 'closed, nothing asks GitHub for the pull requests')
  await h.shot('0-closed')

  await h.click('.wf-section.prs .wf-section-header')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.wf-section.prs .pr-row').length === 2`), 8000), 'open, it lists both open PRs')
  const rows = await h.js(`[...document.querySelectorAll('.pr-row')].map(r => ({ n: r.dataset.pr, text: r.textContent, pill: r.querySelector('.spill')?.className + ' ' + r.querySelector('.spill')?.textContent }))`)
  h.expect(rows[0].n === '128' && rows[1].n === '131', `waiting for my review first (${rows.map((r) => r.n)})`)
  h.expect(/#128/.test(rows[0].text) && /Rate limit the API/.test(rows[0].text) && /maria/.test(rows[0].text) && /\+120/.test(rows[0].text) && /−8/.test(rows[0].text) && /d ago/.test(rows[0].text) && /asks you/.test(rows[0].text), `number, title, author, size, age (${rows[0].text})`)
  h.expect(/tone-attention/.test(rows[0].pill) && /Changes requested/.test(rows[0].pill), `the review decision as a pill (${rows[0].pill})`)
  h.expect(/Draft/.test(rows[1].text) && /tone-neutral/.test(rows[1].pill) && /No review/.test(rows[1].pill), 'the draft has its badge and no review')
  const dots = await h.js(`[...document.querySelectorAll('.pr-row')].map(r => { const c = r.querySelector('.pr-checks'), d = c?.querySelector('.sdot'); return { checks: c?.dataset.checks, cls: d?.className, title: d?.title } })`)
  h.expect(dots[0].checks === 'failed' && /tone-error/.test(dots[0].cls) && !/pulse/.test(dots[0].cls) && dots[0].title === 'Checks failed', `#128: its head failed, the older green run doesn't count (${JSON.stringify(dots[0])})`)
  h.expect(dots[1].checks === 'none' && /tone-neutral/.test(dots[1].cls) && /No checks/.test(dots[1].title), `#131: a run on another commit isn't its head's (${JSON.stringify(dots[1])})`)
  h.expect(fs.readFileSync(log, 'utf8').split('\n').every((l) => !/statusCheckRollup/.test(l) || !/^pr list --state open/.test(l)), 'the list never asks for statusCheckRollup')
  h.expect((await h.js(`document.querySelector('.wf-section.prs .wf-section-header .rt-source')?.textContent`)) === '2', 'the header counts them')
  h.expect(asked() >= 1, 'opening the section asked once')
  await h.wait(400)
  await h.shot('1-list')

  await h.click('.pr-list .seg button', 'Mine')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.pr-row')].map(r => r.dataset.pr).join() === '128'`), 3000), 'Mine: only the one asking me (I opened none)')
  h.expect(await h.js(`window.api.settings.get().then(s => s.prFilter === 'mine')`), 'the filter is remembered')
  await h.click('.pr-list .seg button', "Everyone's")
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.pr-row').length === 2`), 3000), "Everyone's: both again")

  const tabs = (t) => h.js(`[...document.querySelectorAll('.dv-tab')].filter(t => t.textContent.includes(${JSON.stringify(t)})).length`)
  await h.click('.pr-row[data-pr="128"]')
  h.expect(await h.until(async () => (await tabs('#128 Rate limit the API')) === 1, 5000), 'a click opens a Review tab titled #128 Rate limit the API')
  h.expect(await h.until(() => h.js(`document.querySelector('.diff-panel')?.textContent.includes('limiter.js')`), 8000), "the tab shows the PR's diff")
  const wt = path.join(path.dirname(h.fixture), '.sldev-worktrees', path.basename(h.fixture), 'pr-128')
  await h.wait(1000)
  h.expect(!fs.existsSync(wt), 'opening the PR checks nothing out')
  h.expect(g(h.fixture, 'rev-parse', '--abbrev-ref', 'HEAD') === 'main', 'the main checkout stays on its branch')
  await h.wait(800)
  await h.shot('2-review-tab')

  // another PR from the palette in front, then the same PR again: its tab comes back, no second one
  h.key('P', ['control', 'shift'])
  await h.wait(400)
  h.type('Review a pull request')
  await h.wait(300)
  h.expect(await h.js(`document.querySelector('.palette .palette-item')?.textContent.includes('Review a pull request')`), 'the palette offers Review a pull request…')
  h.key('Enter')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.palette .palette-item').length === 2`), 5000), 'the picker lists the open PRs')
  h.type('cache')
  await h.wait(300)
  h.expect(await h.js(`document.querySelector('.palette .palette-item')?.textContent.includes('#131')`), 'fuzzy search finds #131 by its title')
  await h.shot('3-picker')
  h.key('Enter')
  h.expect(await h.until(async () => (await tabs('#131 Try a new cache')) === 1, 5000), 'the picker opens #131 in its own Review tab')
  await h.click('.pr-row[data-pr="128"]')
  await h.wait(500)
  h.expect((await tabs('#128 Rate limit the API')) === 1, 'opening #128 again keeps one tab')
  h.expect(await h.js(`[...document.querySelectorAll('.dv-tab.dv-active-tab')].some(t => t.textContent.includes('#128'))`), 'and focuses it')

  // closed again (or on another tab): no more asking
  await h.click('.wf-section.prs .wf-section-header')
  h.expect(await h.until(() => h.js(`!document.querySelector('.wf-section.prs .wf-section-body')`), 2000), 'the section closes')
  const before = asked()
  await h.click('.right-tab', 'Overview')
  await h.wait(2000)
  h.expect(asked() === before, 'closed or hidden, nothing more is asked')

  for (const n of [128, 131]) await h.js(`window.api.git.removePrWorktree(${JSON.stringify(h.fixture)}, ${n}, { discard: true })`)
  delete process.env.FAKE_GH_LOG
  for (const n of [128, 131]) delete process.env[`FAKE_GH_PR_${n}_HEAD`]
}

module.exports.env = { FAKE_GH_AUTHED: '1' }
