// Walkthrough and Ask why on a pull request: the criteria come from the issue the PR closes, an agent explains
// the PR part by part working in the PR's own worktree (and writes only its file, under the main checkout's
// .sldev/runs), Ask why answers about a part, and once the PR gets a new commit the walkthrough says which head
// it was written for.
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
  h.expect(await h.until(() => fs.existsSync(path.join(wt, 'limiter.js')), 10000), "the PR's head is checked out")

  await h.click('.rc-explain .btn.primary', 'Explain the change')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.rc-part-item:not(.noise) .rc-part-title')].some(t => t.textContent === 'The asked change')`), 20000), "the agent's walkthrough replaces the folders")
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.rc-criteria li.met')].length >= 1`), 3000), 'criteria it meets are ticked')
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
  await h.wait(300)
  await h.shot('2-moved-on')

  await h.js(`window.api.git.removePrWorktree(${JSON.stringify(h.fixture)}, 128, { discard: true })`)
  delete process.env.FAKE_GH_PR_128_HEAD
  void second
}

module.exports.env = { FAKE_GH_AUTHED: '1' }
