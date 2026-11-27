// Run checks in the review cockpit, on a pull request: the PR's head (pushed from a fork as refs/pull/128/head)
// gets a passing typecheck and a failing test, and gh is an older one that refuses closingIssuesReferences. Opening
// it checks nothing out and nothing is installed or run until the click; then the head is checked out in its own
// worktree ("Checking out #128…" on the button), its dependencies are installed once, and each check runs in a terminal of its own: pass/fail per
// command, the failing one's output, a Log button for the whole of it. Run again skips the install; a new commit
// on the PR makes the result stale. Nothing is pushed.
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
  g(fork, 'checkout', '-q', '-b', 'rate-limit')
  const push = (msg) => {
    g(fork, 'add', '-A')
    g(fork, 'commit', '-q', '-m', msg)
    const sha = g(fork, 'rev-parse', 'HEAD')
    g(fork, 'push', '-q', '--force', origin, `${sha}:refs/pull/128/head`)
    process.env.FAKE_GH_PR_128_HEAD = sha
    return sha
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(fork, 'package.json'), 'utf8'))
  pkg.scripts = {
    ...pkg.scripts,
    typecheck: `node -e "console.log('types ok')"`,
    test: `node -e "console.log('limiter.test.js'); console.error('1 test failed: the limiter let 11 requests through'); process.exit(1)"`
  }
  fs.writeFileSync(path.join(fork, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  fs.writeFileSync(path.join(fork, 'src/limiter.js'), 'module.exports = (n) => n <= 11\n')
  const first = push('Rate limit the API')

  await h.openFixture()
  // no list of PRs to open one from yet: put a Review tab on PR #128 in the saved layout, as a restart would
  const lay = {
    grid: { root: { type: 'branch', data: [{ type: 'leaf', data: { views: ['diff-pr-128'], activeView: 'diff-pr-128', id: '1' }, size: 1000 }], size: 700 }, width: 1000, height: 700, orientation: 'HORIZONTAL' },
    panels: { 'diff-pr-128': { id: 'diff-pr-128', contentComponent: 'diff', title: 'Review: #128', params: { target: { kind: 'pr', number: 128, root: h.fixture } } } },
    activeGroup: '1'
  }
  await h.js(`window.api.layout.save(${JSON.stringify(lay)})`)
  await h.reload()
  h.expect(await h.until(() => h.js(`!!document.querySelector('[data-testid="review-checks"]')`), 10000), 'the cockpit on PR #128 has a Checks strip')
  const checks0 = () => h.js(`window.api.store.get('prReviews').then((f) => f?.reviews?.find((r) => r.number === 128)?.review?.checks ?? null)`)
  const strip = () => h.js(`document.querySelector('[data-testid="review-checks"]')?.textContent ?? ''`)
  h.expect((await strip()).includes('Not run'), `nothing has run (${await strip()})`)
  const wtPath = path.join(path.dirname(h.fixture), '.sldev-worktrees', path.basename(h.fixture), 'pr-128')
  await h.wait(1500)
  // the diff is GitHub's: opening the PR fetches nothing and makes no worktree
  h.expect(!fs.existsSync(wtPath) && !g(h.fixture, 'for-each-ref', 'refs/sldev'), 'no worktree and no fetch until Run checks')
  h.expect((await checks0()) === null, 'no check result before the click')
  await h.shot('1-not-run')

  const checks = () => h.js(`window.api.store.get('prReviews').then((f) => f?.reviews?.find((r) => r.number === 128)?.review?.checks ?? null)`)
  await h.js(`window.__sawCheckout = false; new MutationObserver(() => { if (document.querySelector('[data-testid="review-checks"]')?.textContent.includes('Checking out #128')) window.__sawCheckout = true }).observe(document.body, { subtree: true, childList: true, characterData: true })`)
  await h.js(`[...document.querySelectorAll('[data-testid="review-checks"] button')].find((b) => b.textContent.includes('Run checks')).click()`)
  h.expect(await h.until(() => h.js('window.__sawCheckout'), 5000), 'the button says "Checking out #128…" while the head is checked out')
  const done = await h.until(async () => {
    const c = await checks()
    return c?.status === 'done' && c
  }, 120000, 500)
  h.expect(done, `the checks finished (${JSON.stringify(await checks())})`)
  h.expect(done.path === wtPath && done.head === first, `ran in the PR's worktree at its head (${done.path} ${done.head})`)
  h.expect(done.setup?.ok && /npm/.test(done.setup.command) && fs.existsSync(path.join(wtPath, '.sldev/runs/.setup-done')), `dependencies installed first (${JSON.stringify(done.setup)})`)
  const byName = Object.fromEntries(done.results.map((r) => [r.name, r]))
  h.expect(byName.typecheck?.status === 'passed' && byName.test?.status === 'failed' && byName.test.code === 1, `typecheck passed, test failed (${JSON.stringify(done.results.map((r) => [r.name, r.status, r.code]))})`)
  h.expect(byName.test.tail.includes('1 test failed'), `the failing output is kept (${byName.test.tail})`)
  h.expect(await h.until(() => h.js(`document.querySelector('[data-testid="review-checks"] [aria-label="test output"]')?.textContent.includes('1 test failed') ?? false`), 5000), 'the failure opens with its output')
  h.expect((await strip()).includes('test failed, typecheck passed'), `the strip says which failed (${await strip()})`)
  const tabs = await h.js(`[...document.querySelectorAll('.dv-tab')].map((t) => t.textContent)`)
  h.expect(tabs.some((t) => t.startsWith('typecheck ·')) && tabs.some((t) => t.startsWith('test ·')), `each check has its own terminal (${tabs})`)

  // Log opens that check's terminal
  await h.wait(500)
  await h.shot('2-failed')
  await h.js(`document.querySelector('.rc-check[data-check="test"] button').click()`)
  await h.wait(600)
  h.expect(await h.js(`[...document.querySelectorAll('.dv-tab.dv-active-tab')].some((t) => t.textContent.startsWith('test ·'))`), 'Log brings up the test terminal')
  await h.shot('3-log')

  // again: no second install
  await h.js(`[...document.querySelectorAll('[data-testid="review-checks"] button')].find((b) => b.textContent.includes('Run again')).click()`)
  const again = await h.until(async () => {
    const c = await checks()
    return c?.status === 'done' && c.at > done.at && c
  }, 60000, 500)
  h.expect(again && !again.setup, `the second run doesn't install again (${JSON.stringify(again?.setup)})`)

  // a new commit on the PR: the result is for an older head
  fs.writeFileSync(path.join(fork, 'src/limiter.js'), 'module.exports = (n) => n <= 10\n')
  const second = push('Fix the off-by-one')
  await h.js(`[...document.querySelectorAll('.dv-tab')].find((t) => t.textContent.startsWith('Review'))?.click()`)
  await h.reload()
  h.expect(await h.until(async () => (await strip()).includes('Stale'), 10000), `a new commit makes it stale (${await strip()})`)
  h.expect((await strip()).includes(`${first.slice(0, 7)}; the review is at ${second.slice(0, 7)}`), 'it says which commits')
  await h.wait(500)
  await h.shot('4-stale')

  h.expect(g(origin, 'for-each-ref', '--format=%(refname)', 'refs/heads').split('\n').join(',') === 'refs/heads/main', 'nothing was pushed')
  h.expect(g(h.fixture, 'rev-parse', '--abbrev-ref', 'HEAD') === 'main' && !fs.existsSync(path.join(h.fixture, 'src/limiter.js')), 'the main checkout is untouched')
  await h.js(`window.api.git.removePrWorktree(${JSON.stringify(h.fixture)}, 128, { discard: true })`)
}

module.exports.env = { FAKE_GH_AUTHED: '1', FAKE_GH_OLD: '1' }
