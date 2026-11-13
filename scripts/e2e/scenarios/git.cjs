// Git view in the left activity bar: status, Fetch and Pull (fast-forward only) against a bare remote in the temp dir.
// A diverged branch shows git's message and nothing is merged; a folder outside git gets an empty state.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ID = ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e']

module.exports = async (h) => {
  const tmp = path.dirname(h.fixture)
  const remote = path.join(tmp, 'remote.git')
  const other = path.join(tmp, 'other')
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  // the fixture tracks a bare remote; "other" is a teammate's clone that pushes to it
  git(tmp, 'clone', '-q', '--bare', h.fixture, remote)
  git(h.fixture, 'remote', 'add', 'origin', remote)
  git(h.fixture, 'fetch', '-q', 'origin')
  git(h.fixture, 'branch', '-q', '--set-upstream-to=origin/main', 'main')
  git(tmp, 'clone', '-q', remote, other)
  const teammateCommit = (file) => {
    fs.writeFileSync(path.join(other, file), `${file}\n`)
    git(other, 'add', '.')
    git(other, ...ID, 'commit', '-qm', `add ${file}`)
    git(other, 'push', '-q', 'origin', 'main')
  }
  teammateCommit('teammate.txt')

  await h.openFixture({ sidebarWidth: 300 })
  const text = (sel) => h.js(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`)
  const toast = () => text('.toast')

  h.expect(await h.js(`!!document.querySelector('.activity-btn[aria-label="Git"]')`), 'Git is on the left activity bar')
  await h.click('.activity-btn[aria-label="Git"]')
  h.expect(await h.until(() => h.js(`!!document.querySelector('[data-testid="git-view"]')`), 5000), 'the Git view opens')
  h.expect((await text('.git-branch-name')) === 'main', 'shows the current branch')
  h.expect((await text('.git-upstream-name')) === 'origin/main', 'shows the upstream')
  h.expect(await h.js(`document.querySelector('[data-behind]')?.dataset.behind === '0'`), 'nothing to pull before a fetch')
  h.expect((await text('.git-changes')).includes('Working tree clean'), 'clean working tree')
  await h.shot('1-status')

  // Fetch: the teammate's commit shows as one to pull
  await h.click('.git-actions .btn', 'Fetch')
  h.expect(await h.until(() => h.js(`document.querySelector('.toast')?.textContent.includes('1 new commit to pull')`), 15000), `fetch toast says what came in (${await toast()})`)
  h.expect(await h.until(() => h.js(`document.querySelector('[data-behind]')?.dataset.behind === '1'`), 3000), 'behind count is 1 after fetch')
  await h.shot('2-fetched')

  // Pull: fast-forwards
  await h.click('.git-actions .btn', 'Pull')
  h.expect(await h.until(() => h.js(`document.querySelector('.toast')?.textContent.includes('Pulled 1 commit')`), 15000), `pull toast says it pulled (${await toast()})`)
  h.expect(fs.existsSync(path.join(h.fixture, 'teammate.txt')), 'the pulled file is in the project')
  h.expect(await h.until(() => h.js(`document.querySelector('[data-behind]')?.dataset.behind === '0'`), 3000), 'behind count is back to 0')
  await h.shot('3-pulled')

  // Diverge: a local commit plus a new remote one; Pull from the palette must refuse and merge nothing
  teammateCommit('teammate2.txt')
  fs.writeFileSync(path.join(h.fixture, 'local.txt'), 'mine\n')
  git(h.fixture, 'add', 'local.txt')
  git(h.fixture, ...ID, 'commit', '-qm', 'local work')
  const headBefore = git(h.fixture, 'rev-parse', 'HEAD')
  await h.click('.git-actions .btn', 'Fetch')
  h.expect(await h.until(() => h.js(`document.querySelector('[data-ahead]')?.dataset.ahead === '1' && document.querySelector('[data-behind]')?.dataset.behind === '1'`), 15000), 'diverged: 1 ahead, 1 behind')
  h.key('P', ['control', 'shift'])
  await h.wait(400)
  h.type('git pull')
  await h.wait(300)
  h.expect(await h.js(`document.querySelector('.palette .palette-item')?.textContent.includes('Pull')`), 'the palette offers Git: Pull')
  h.key('Enter')
  h.expect(await h.until(() => h.js(`document.querySelector('.toast.tone-error')?.textContent.includes('Pull failed')`), 15000), `pull failure toast (${await toast()})`)
  h.expect(await h.until(() => h.js(`/fast-forward/i.test(document.querySelector('.git-error')?.textContent ?? '')`), 3000), "the view shows git's message")
  h.expect(git(h.fixture, 'rev-parse', 'HEAD') === headBefore, 'HEAD did not move: nothing was merged')
  h.expect(!fs.existsSync(path.join(h.fixture, 'teammate2.txt')), "the remote's new file is not in the working tree")
  h.expect(git(h.fixture, 'status', '--porcelain') === '', 'the working tree is untouched')
  await h.shot('4-diverged')

  // Git: Fetch from the palette works too
  h.key('P', ['control', 'shift'])
  await h.wait(400)
  h.type('git fetch')
  await h.wait(300)
  h.key('Enter')
  h.expect(await h.until(() => h.js(`document.querySelector('.toast:not(.tone-error)')?.textContent.includes('Fetched')`), 15000), `palette fetch toast (${await toast()})`)

  // a folder outside git: an empty state, not an error
  const plain = path.join(tmp, 'plain')
  fs.mkdirSync(plain)
  await h.js(`window.api.settings.set({ rootFolder: ${JSON.stringify(plain)} })`)
  await h.reload()
  await h.click('.activity-btn[aria-label="Git"]')
  h.expect(await h.until(() => h.js(`document.querySelector('.sidebar .empty-title')?.textContent === 'Not a git repository'`), 5000), 'non-repo folder shows the empty state')
  h.expect(await h.js(`!document.querySelector('.sidebar .error-banner')`), 'and no error')
  await h.shot('5-not-a-repo')
}
