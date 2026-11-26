// Reading a repo's open pull requests and checking one out for review: the fake gh lists two PRs, a bare
// "GitHub" origin serves their heads as refs/pull/<n>/head (pushed from a fork, on no branch), and each head
// lands detached in its own worktree. Asking again reuses it, new commits move it, and nothing touches the
// user's branches or main checkout. No UI yet: this drives window.api the way the review list will.
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
    return sha
  }
  g(fork, 'checkout', '-q', '-b', 'rate-limit')
  const first = prCommit(128, 'limiter.js')
  g(fork, 'checkout', '-q', '-b', 'cache', 'main')
  const cache = prCommit(131, 'cache.js')

  await h.openFixture()
  const root = JSON.stringify(h.fixture)
  const prs = await h.js(`window.api.gh.prs(${root})`)
  h.expect(!prs.error && prs.prs.length === 2, `two open PRs (${JSON.stringify(prs.error)})`)
  h.expect(prs.prs[0].number === 131 && prs.prs[1].number === 128, 'newest first')
  const p128 = prs.prs.find((p) => p.number === 128)
  h.expect(p128.author === 'maria' && p128.additions === 120 && p128.changedFiles === 4 && !p128.isDraft && p128.reviewDecision === 'CHANGES_REQUESTED', 'author, size, draft and review decision')
  h.expect(prs.prs[0].isDraft && prs.prs[0].reviewDecision === null, 'a draft without a review decision')
  const detail = await h.js(`window.api.gh.prDetail(${root}, 128)`)
  h.expect(detail.body.includes('Fixes #42') && detail.linkedIssues[0]?.number === 42 && detail.linkedIssues[0].repo === 'acme/shop', 'detail has the body and the issue it closes')

  const branchesBefore = g(h.fixture, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes')
  const wt = await h.js(`window.api.git.prWorktree(${root}, 128, ${JSON.stringify(p128.headSha)})`)
  h.expect(wt.action === 'created' && wt.head === first && !wt.listedOther, `PR #128 checked out (${JSON.stringify(wt)})`)
  h.expect(fs.existsSync(path.join(wt.path, 'limiter.js')) && path.basename(wt.path) === 'pr-128', 'its own worktree has the PR\'s file')
  h.expect(g(wt.path, 'rev-parse', '--abbrev-ref', 'HEAD') === 'HEAD', 'detached')
  const again = await h.js(`window.api.git.prWorktree(${root}, 128, ${JSON.stringify(first)})`)
  h.expect(again.action === 'reused' && again.path === wt.path, 'same head: reused')

  const second = prCommit(128, 'limiter-test.js')
  const fresh = (await h.js(`window.api.gh.prs(${root})`)).prs.find((p) => p.number === 128)
  h.expect(fresh.headSha === second, 'the list shows the new head')
  const moved = await h.js(`window.api.git.prWorktree(${root}, 128, ${JSON.stringify(fresh.headSha)})`)
  h.expect(moved.action === 'moved' && moved.head === second && g(wt.path, 'rev-parse', 'HEAD') === second, 'new commits move the worktree')
  const other = await h.js(`window.api.git.prWorktree(${root}, 131, ${JSON.stringify(cache)})`)
  h.expect(other.action === 'created' && other.path !== wt.path && fs.existsSync(path.join(other.path, 'cache.js')), 'PR #131 gets a worktree of its own')

  h.expect(g(h.fixture, 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes') === branchesBefore, 'no branch of the user\'s was made or moved')
  h.expect(g(h.fixture, 'rev-parse', '--abbrev-ref', 'HEAD') === 'main' && !fs.existsSync(path.join(h.fixture, 'limiter.js')), 'the main checkout is untouched')
  h.expect(g(origin, 'for-each-ref', '--format=%(refname)', 'refs/heads').split('\n').join(',') === 'refs/heads/main', 'nothing was pushed')

  // the Git view's worktree list shows them
  await h.click('.activitybar button[title^="Git"]')
  h.expect(await h.until(() => h.js(`document.body.textContent.includes('pr-128')`), 8000), 'the Git view lists the PR worktree')
  await h.wait(600)
  await h.shot('1-pr-worktrees')

  await h.js(`window.api.git.removePrWorktree(${root}, 128)`)
  await h.js(`window.api.git.removePrWorktree(${root}, 131)`)
  h.expect(!fs.existsSync(wt.path) && !fs.existsSync(other.path), 'removed again')

  process.env.FAKE_GH_MISSING = '1'
  const none = await h.js(`window.api.gh.prs(${root})`)
  delete process.env.FAKE_GH_MISSING
  h.expect(none.prs.length === 0 && /not installed/.test(none.error), `without gh the call says so (${none.error})`)
}

module.exports.env = { FAKE_GH_AUTHED: '1' }
