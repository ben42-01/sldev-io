// Walkthrough and Ask why on a pull request: the criteria come from the issue the PR closes, opening it checks
// nothing out, Explain the change checks the PR out first ("Checking out #128…") and the agent explains the PR part
// by part working in the PR's own worktree (and writes only its file, under the main checkout's .sldev/runs), Ask why
// answers about a part, and once the PR gets a new commit the walkthrough says which head it was written for. A question
// asked while the (slowed) checkout runs waits for that one checkout; a failed one runs no helper anywhere, and
// Explain reads no second `gh pr diff` while the head hasn't moved. Then with an older gh that refuses
// closingIssuesReferences, the PR still opens with its diff and walkthrough.
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
  const push = (file, text) => {
    fs.writeFileSync(path.join(fork, file), text)
    g(fork, 'add', '-A')
    g(fork, 'commit', '-q', '-m', file)
    const sha = g(fork, 'rev-parse', 'HEAD')
    g(fork, 'push', '-q', '--force', origin, `${sha}:refs/pull/128/head`)
    process.env.FAKE_GH_PR_128_HEAD = sha
    return sha
  }
  const first = push('limiter.js', 'export const limit = 100\n')

  await h.openFixture({ rightPanelVisible: true, rightPanelTab: 'workflows', rightPanelWidth: 360, reviewFocus: false })
  await h.click('.wf-section.prs .wf-section-header')
  await h.until(() => h.js(`!!document.querySelector('.pr-row[data-pr="128"]')`), 8000)
  await h.click('.pr-row[data-pr="128"]')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.rc .rc-part')`), 10000), 'the PR opens in the cockpit')
  const crit = () => h.js(`[...document.querySelectorAll('.rc-criteria li')].map(l => l.textContent)`)
  h.expect(await h.until(async () => (await crit()).some((c) => c.includes('11th request in a minute gets a 429')) && (await crit()).some((c) => c.includes('per API key')), 5000), `the criteria come from the issue it closes (${await crit()})`)
  const wt = path.join(tmp, '.sldev-worktrees', path.basename(h.fixture), 'pr-128')
  await h.wait(1000)
  h.expect(!fs.existsSync(wt) && !g(h.fixture, 'for-each-ref', 'refs/sldev'), 'opening the PR fetches and checks out nothing')

  // a checkout that fails (a stray folder where the worktree goes) says so on the action, and the diff stays
  fs.mkdirSync(wt, { recursive: true })
  await h.click('.rc-explain .btn.primary', 'Explain the change')
  h.expect(await h.until(() => h.js(`document.querySelector('.rc-error')?.textContent.includes("Couldn't check out #128")`), 10000), `a failed checkout shows on Explain (${await h.js(`document.querySelector('.rc-error')?.textContent`)})`)
  h.expect(await h.js(`!!document.querySelector('.rc .rc-part')`), 'and the diff stays usable')
  const helpers = async () => (await h.js(`window.api.store.get('missions').then(s => s.missions)`)).filter((m) => m.explains)
  await h.wait(500)
  h.expect((await helpers()).length === 0, 'a failed checkout starts no helper (never in the main checkout)')
  await h.shot('0-checkout-failed')
  fs.rmSync(wt, { recursive: true, force: true })

  // a slow checkout (a big repository), with a question asked while it runs: both wait for the one checkout, which
  // fetches once and adds the worktree once; git is wrapped to log those and take 2.5 s over each fetch
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
  const wrap = path.join(tmp, 'slowgit')
  const gitLog = path.join(tmp, 'git-calls.log')
  fs.mkdirSync(wrap, { recursive: true })
  fs.writeFileSync(path.join(wrap, 'git'), `#!/bin/sh\ncase "$1" in fetch) echo fetch >> "${gitLog}"; sleep 2.5;; worktree) [ "$2" = add ] && echo "worktree add" >> "${gitLog}";; esac\nexec "${realGit}" "$@"\n`, { mode: 0o755 })
  const pathBefore = process.env.PATH
  const ghLog = path.join(tmp, 'gh-calls.log')
  process.env.FAKE_GH_LOG = ghLog
  process.env.PATH = `${wrap}${path.delimiter}${process.env.PATH}`
  await h.click('.rc-actions .btn', 'Ask why')
  await h.setValue('.rc-form input', 'What does this folder do?')
  await h.js(`window.__sawCheckout = false; new MutationObserver(() => { if ([...document.querySelectorAll('.rc button')].some((b) => b.textContent.includes('Checking out #128'))) window.__sawCheckout = true }).observe(document.body, { subtree: true, childList: true, characterData: true })`)
  await h.click('.rc-explain .btn.primary', 'Explain the change')
  h.expect(await h.until(() => h.js('window.__sawCheckout'), 3000), 'the button says "Checking out #128…" meanwhile')
  await h.click('.rc-form .btn.primary', 'Ask')
  h.expect(await h.until(() => fs.existsSync(path.join(wt, 'limiter.js')), 15000), "Explain the change checks the PR's head out first")
  const asked = await h.until(async () => (await h.js(`window.api.store.get('missions').then(s => s.missions)`)).find((m) => m.explains && m.prompt.includes('What does this folder do?')), 15000)
  h.expect(asked?.cwd === wt, `the question asked during the checkout ran in the PR's worktree too (${asked?.cwd})`)
  const calls = fs.readFileSync(gitLog, 'utf8').trim().split('\n')
  h.expect(calls.filter((c) => c === 'fetch').length === 1 && calls.filter((c) => c === 'worktree add').length === 1, `one fetch and one worktree add for both (${calls})`)
  process.env.PATH = pathBefore
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.rc-part-item:not(.noise) .rc-part-title')].some(t => t.textContent === 'The asked change')`), 20000), "the agent's walkthrough replaces the folders")
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.rc-criteria li.met')].length >= 1`), 3000), 'criteria it meets are ticked')
  const ghCalls = fs.existsSync(ghLog) ? fs.readFileSync(ghLog, 'utf8') : ''
  h.expect(!/^pr diff/m.test(ghCalls), `Explain reused the diff the tab read: no second gh pr diff (${ghCalls.trim().split('\n')})`)
  const missions = await h.js(`window.api.store.get('missions').then(s => s.missions)`)
  const walk = missions.find((m) => m.explains && m.prompt.startsWith('Walkthrough:'))
  h.expect(walk?.cwd === wt, `the helper worked in the PR's worktree (${walk?.cwd})`)
  h.expect(walk.prompt.includes('Too many requests'), 'and was told about the issue the PR closes')
  const runs = fs.readdirSync(path.join(h.fixture, '.sldev', 'runs')).filter((d) => d.startsWith('review-pr-128'))
  h.expect(runs.length === 1 && fs.readdirSync(path.join(h.fixture, '.sldev', 'runs', runs[0])).some((f) => f.startsWith('walkthrough-')), `its file is under the main checkout's .sldev/runs/review-pr-128… (${runs})`)
  h.expect(g(wt, 'status', '--porcelain') === '', "the PR's worktree is left clean")
  h.expect(!missions.some((m) => !m.explains && m.title.includes('Walkthrough')), 'the helper is kept off the missions list')
  await h.wait(400)
  await h.shot('1-walkthrough')

  await h.click('.rc-actions .btn', 'Ask why')
  await h.setValue('.rc-form input', 'Why 100?')
  await h.click('.rc-form .btn.primary', 'Ask')
  h.expect(await h.until(() => h.js(`document.querySelector('.rc-a')?.textContent.includes('nothing calls it')`), 20000), 'Ask why answers under the part')
  h.expect(g(wt, 'status', '--porcelain') === '', 'still clean after the question')

  // the author pushes again: the walkthrough says which head it was written for
  const second = push('limiter.js', 'export const limit = 10\n')
  await h.js(`document.querySelector('.diff-panel [title^="Refresh"], .diff-panel [aria-label^="Refresh"]')?.click()`)
  h.expect(await h.until(() => h.js(`document.querySelector('.rc-stale')?.textContent.includes(${JSON.stringify(`Written for ${first.slice(0, 7)}`)})`), 10000), `a walkthrough of an older head says so (${await h.js(`document.querySelector('.rc-stale')?.textContent`)})`)
  h.expect(await h.js(`!!document.querySelector('.rc-stale .btn')`), 'with Explain again')
  h.expect(/^pr diff 128/m.test(fs.readFileSync(ghLog, 'utf8')), "the refresh did read gh pr diff (so the log above is live)")
  delete process.env.FAKE_GH_LOG
  await h.wait(300)
  await h.shot('2-moved-on')

  // an older gh that refuses closingIssuesReferences: the PR still opens, its diff and walkthrough work, only the
  // criteria from the issue it closes are missing
  process.env.FAKE_GH_OLD = '1'
  await h.reload()
  h.expect(await h.until(() => h.js(`!!document.querySelector('.rc .rc-part') && !!document.querySelector('.rc-stale')`), 10000), 'with an older gh, the PR opens with its diff and walkthrough')
  h.expect(!(await crit()).some((c) => c.includes('429')), `only the issue's criteria are missing (${await crit()})`)
  await h.shot('3-older-gh')
  delete process.env.FAKE_GH_OLD

  await h.js(`window.api.git.removePrWorktree(${JSON.stringify(h.fixture)}, 128, { discard: true })`)
  delete process.env.FAKE_GH_PR_128_HEAD
  void second
}

module.exports.env = { FAKE_GH_AUTHED: '1' }
