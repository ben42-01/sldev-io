// The Pull requests list flags a PR that changed since you reviewed it. #128 opened from the list and given a verdict
// on a part: no badge (reviewed at its head). A new commit pushed to refs/pull/128/head (FAKE_GH_PR_128_HEAD moves),
// Refresh: "Changed since your review" shows on #128 only, and a click opens its Review tab on "Since last review",
// with only the new hunks. With the tab already open (and on the whole diff), the badge turns the filter on again.
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
  const prCommit = (n, file, text = `${file}\n`) => {
    fs.mkdirSync(path.dirname(path.join(fork, file)), { recursive: true })
    fs.writeFileSync(path.join(fork, file), text)
    g(fork, 'add', file)
    g(fork, 'commit', '-q', '-m', file)
    const sha = g(fork, 'rev-parse', 'HEAD')
    g(fork, 'push', '-q', '--force', origin, `${sha}:refs/pull/${n}/head`)
    process.env[`FAKE_GH_PR_${n}_HEAD`] = sha
    return sha
  }
  g(fork, 'checkout', '-q', '-b', 'rate-limit')
  prCommit(128, 'limiter.js')
  g(fork, 'checkout', '-q', '-b', 'cache', 'main')
  prCommit(131, 'cache.js')

  await h.openFixture({ rightPanelVisible: true, rightPanelTab: 'workflows', rightPanelWidth: 380, reviewFocus: false, reviewView: 'walk' })
  h.expect(await h.until(() => h.js(`!!document.querySelector('.wf-section.prs .wf-section-header')`), 8000), 'a Pull requests section')
  await h.click('.wf-section.prs .wf-section-header')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.pr-row').length === 2`), 8000), 'both open PRs are listed')
  const badges = () => h.js(`[...document.querySelectorAll('.pr-row')].filter(r => r.querySelector('.pr-since')).map(r => r.dataset.pr).join()`)
  h.expect((await badges()) === '', 'never reviewed: no badge')

  // review #128: a verdict on its part
  await h.click('.pr-row[data-pr="128"]')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.rc .rc-part') && document.querySelector('.diff-panel')?.textContent.includes('limiter.js')`), 8000), "#128's Review tab opens on the walkthrough")
  await h.click('.rc-actions .btn', 'Looks good')
  const saved = () => h.js(`window.api.store.get('prReviews').then(f => (f?.reviews ?? []).find(r => r.number === 128)?.review?.seen?.head ?? '')`)
  h.expect(await h.until(async () => (await saved()) === process.env.FAKE_GH_PR_128_HEAD, 5000), 'the verdict is saved with the head it was on')
  await h.wait(300)
  h.expect((await badges()) === '', 'reviewed at its current head: no badge')

  // the author pushes: a fix to the reviewed file and a new one
  g(fork, 'checkout', '-q', 'rate-limit')
  fs.writeFileSync(path.join(fork, 'limiter.js'), 'limiter.js\nmax = 100\n')
  g(fork, 'add', 'limiter.js')
  g(fork, 'commit', '-q', '-m', 'max')
  prCommit(128, 'limiter.test.js', 'test the limiter\n')
  // close the tab, so the badge opens a fresh one
  await h.js(`document.querySelectorAll('.dv-default-tab-action, .dv-tab .tab-close').forEach(b => b.click())`)
  await h.click('.pr-list [aria-label="Refresh pull requests"]')
  h.expect(await h.until(async () => (await badges()) === '128', 8000), `new commits: #128 shows the badge, #131 (never reviewed) doesn't (${await badges()})`)
  const pill = await h.js(`document.querySelector('.pr-row[data-pr="128"] .pr-since .spill')?.className + ' ' + document.querySelector('.pr-row[data-pr="128"] .pr-since')?.textContent`)
  h.expect(/tone-review/.test(pill) && /Changed since your review/.test(pill), `a review-toned pill (${pill})`)
  h.expect((await h.js(`[...document.querySelectorAll('.pr-row')].map(r => r.dataset.pr).join()`)) === '128,131', 'waiting for me and changed stays first')
  await h.wait(300)
  await h.shot('1-changed-badge')

  const sinceOn = () => h.js(`document.querySelector('.rc-since .btn')?.getAttribute('aria-pressed') === 'true'`)
  await h.click('.pr-row[data-pr="128"] .pr-since')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.dv-tab')].some(t => t.textContent.includes('#128 Rate limit the API'))`), 5000), 'the badge opens #128 in a Review tab')
  h.expect(await h.until(sinceOn, 10000), `it opens on Since last review (${await h.js(`document.querySelector('.rc-since')?.textContent`)})`)
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.rc-part-item:not(.noise)')].map(b => b.querySelector('.rc-part-title').textContent).join() === 'Changes at the top level,Tests'`), 5000), 'only the changed parts: the edited file and the new test')
  await h.wait(600)
  await h.shot('2-since-last-review')

  // already open, back on the whole diff: the badge turns the filter on again
  await h.click('.rc-since .btn', 'Since last review')
  h.expect(await h.until(async () => !(await sinceOn()), 3000), 'the toggle goes off')
  await h.click('.pr-row[data-pr="128"] .pr-since')
  h.expect(await h.until(sinceOn, 5000), 'the badge turns Since last review on in the open tab')
  h.expect((await h.js(`[...document.querySelectorAll('.dv-tab')].filter(t => t.textContent.includes('#128')).length`)) === 1, 'still one tab')

  for (const n of [128, 131]) await h.js(`window.api.git.removePrWorktree(${JSON.stringify(h.fixture)}, ${n}, { discard: true })`)
  for (const n of [128, 131]) delete process.env[`FAKE_GH_PR_${n}_HEAD`]
}

module.exports.env = { FAKE_GH_AUTHED: '1', FAKE_GH_PR_DIFF_REAL: '1' }
