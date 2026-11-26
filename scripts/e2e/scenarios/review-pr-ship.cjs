// The ship bar on a pull request's Review tab: checks from its head's Actions runs, and the reviewer's actions, each
// only on a click and asked first. A note on a part becomes an inline comment on its first changed line in one review
// (Request changes, with a summary), Approve posts an approving review, and Merge merges exactly the reviewed commit;
// new commits since block it until the review is refreshed.
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
  const push = (text) => {
    fs.writeFileSync(path.join(fork, 'limiter.js'), text)
    g(fork, 'add', '-A')
    g(fork, 'commit', '-q', '-m', text)
    const sha = g(fork, 'rev-parse', 'HEAD')
    g(fork, 'push', '-q', '--force', origin, `${sha}:refs/pull/128/head`)
    process.env.FAKE_GH_PR_128_HEAD = sha
    return sha
  }
  const first = push('export const limit = 100\n')
  const posted = path.join(h.fixture, 'review-128.json')
  const merged = path.join(h.fixture, 'merge-128.txt')

  await h.openFixture({ rightPanelVisible: true, rightPanelTab: 'workflows', rightPanelWidth: 340, reviewFocus: false })
  await h.click('.wf-section.prs .wf-section-header')
  await h.until(() => h.js(`!!document.querySelector('.pr-row[data-pr="128"]')`), 8000)
  await h.click('.pr-row[data-pr="128"]')
  const bar = () => h.js(`document.querySelector('[data-testid="pr-ship"]')?.textContent ?? ''`)
  h.expect(await h.until(async () => (await bar()).includes('#128') && (await bar()).includes('Passed'), 10000), `the bar shows the PR and its head's checks (${await bar()})`)
  h.expect((await bar()).includes('Ready to merge') && (await bar()).includes('Review required'), 'and that it is ready to merge, waiting for a review')
  await h.wait(300)
  await h.shot('1-bar')

  // a note on the part
  await h.until(() => h.js(`!!document.querySelector('.rc .rc-part')`), 8000)
  await h.click('.rc-actions .btn', 'Send back')
  await h.setValue('.rc-form textarea', 'Make the limit configurable per key.')
  await h.click('.rc-form .btn.primary', 'Save note')
  h.expect(await h.until(() => h.js(`document.querySelector('.rc-foot .btn.primary')?.textContent.includes('Post 1 note to #128')`), 3000), 'for a PR, the footer offers to post the notes')
  h.expect(!fs.existsSync(posted), 'nothing is posted yet')

  // Request changes: the note sits on the part's first changed line, the summary on top
  await h.click('.rc-foot .btn.primary', 'Post 1 note')
  h.expect(await h.until(() => h.js(`!!document.querySelector('dialog[open] .post-review-comments li')`), 5000), 'the dialog lists the note as a comment')
  const at = await h.js(`document.querySelector('dialog[open] .post-review-at .mono')?.textContent`)
  h.expect(at === 'limiter.js:1', `on the part's first changed line (${at})`)
  await h.click('dialog[open] .seg button', 'Request changes')
  await h.setValue('dialog[open] .post-review textarea', 'Close, a few things.')
  await h.wait(200)
  await h.shot('2-post-review')
  h.expect(!fs.existsSync(posted), 'still nothing posted before the click')
  await h.click('dialog[open] .btn.primary', 'Request changes with 1 comment')
  h.expect(await h.until(() => fs.existsSync(posted), 8000), 'the click posts one review')
  const r = JSON.parse(fs.readFileSync(posted, 'utf8'))
  h.expect(r.event === 'REQUEST_CHANGES' && r.body === 'Close, a few things.' && r.commit_id === first, `request changes, with the summary, on the reviewed commit (${JSON.stringify({ event: r.event, body: r.body, commit: r.commit_id })})`)
  h.expect(r.comments.length === 1 && r.comments[0].path === 'limiter.js' && r.comments[0].line === 1 && r.comments[0].side === 'RIGHT' && r.comments[0].body === 'Make the limit configurable per key.', `the note as an inline comment (${JSON.stringify(r.comments)})`)
  h.expect(await h.until(() => h.js(`!document.querySelector('dialog[open]')`), 3000), 'the dialog closes')
  fs.rmSync(posted)

  // Approve asks first
  await h.click('[data-testid="pr-ship"] .btn', 'Approve')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('dialog[open]')].some(d => d.textContent.includes('Approve #128?'))`), 3000), 'approving asks first')
  h.expect(!fs.existsSync(posted), 'and posts nothing until confirmed')
  await h.click('dialog[open] .btn.primary', 'Approve')
  h.expect(await h.until(() => fs.existsSync(posted) && JSON.parse(fs.readFileSync(posted, 'utf8')).event === 'APPROVE', 8000), 'then posts an approving review')

  // the author pushes again: merge is blocked until the review is refreshed
  const second = push('export const limit = Number(process.env.LIMIT ?? 100)\n')
  await h.click('[data-testid="pr-ship"] .icon-btn[aria-label="Refresh the pull request and checks"]')
  h.expect(await h.until(async () => (await bar()).includes('New commits since you looked'), 8000), `new commits block the merge (${await bar()})`)
  h.expect(await h.js(`[...document.querySelectorAll('[data-testid="pr-ship"] .ship-split .btn')].every(b => b.disabled)`), 'the merge button is off')
  await h.shot('3-moved-on')
  await h.click('.diff-toolbar .icon-btn[aria-label="Refresh"], .diff-panel .icon-btn[aria-label="Refresh"]')
  h.expect(await h.until(async () => (await bar()).includes('Ready to merge'), 10000), `refreshing the review makes it mergeable again (${await bar()})`)

  // merge: asked first, exactly the reviewed commit
  await h.click('[data-testid="pr-ship"] .ship-split .btn', 'Squash & merge')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('dialog[open]')].some(d => d.textContent.includes('Merge #128 into main'))`), 3000), 'merging asks first')
  h.expect(!fs.existsSync(merged), 'nothing is merged before the confirm')
  await h.click('dialog[open] .btn.primary', 'Merge')
  h.expect(await h.until(() => fs.existsSync(merged), 8000), 'confirming merges')
  const args = fs.readFileSync(merged, 'utf8')
  h.expect(args.includes('--squash') && args.includes(`--match-head-commit ${second}`), `with the reviewed commit (${args.trim()})`)
  h.expect(await h.until(async () => (await bar()).includes('Merged'), 10000), 'the bar says it is merged')
  await h.wait(300)
  await h.shot('4-merged')

  await h.js(`window.api.git.removePrWorktree(${JSON.stringify(h.fixture)}, 128, { discard: true })`)
  delete process.env.FAKE_GH_PR_128_HEAD
}

module.exports.env = { FAKE_GH_AUTHED: '1' }
