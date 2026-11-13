// Git view in the left activity bar: status, Fetch and Pull (fast-forward only) against a bare remote in the temp dir.
// A diverged branch shows git's message and nothing is merged; a folder outside git gets an empty state.
// Branches: create (an invalid name gets a hint), switch, a dirty tree refuses to switch and changes nothing.
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

  // ── Branches ──
  const row = (name) => `.git-branch-row[data-branch=${JSON.stringify(name)}]`
  const currentRow = () => h.js(`document.querySelector('.git-branch-row.current')?.dataset.branch ?? ''`)
  const branchNow = () => git(h.fixture, 'rev-parse', '--abbrev-ref', 'HEAD')
  h.expect(await h.until(() => h.js(`!!document.querySelector('[data-testid="git-branches"]')`), 5000), 'the Branches section shows')
  h.expect((await currentRow()) === 'main', `main is marked current (${await currentRow()})`)
  h.expect(await h.js(`!!document.querySelector(${JSON.stringify(row('main'))} + ' time, ' + ${JSON.stringify(row('main'))} + ' .git-row-time')`), 'the last commit time is shown')
  h.expect(await h.js(`!document.querySelector('[data-remote-branch]')`), 'remote branches start folded')
  await h.click('[data-testid="git-remote-toggle"]')
  h.expect(await h.until(() => h.js(`!!document.querySelector('[data-remote-branch="origin/main"]')`), 3000), 'unfolding shows origin/main')

  // New branch: an invalid name is rejected with a hint under the field, then a good one is created and checked out
  await h.click('[data-testid="git-new-branch"]')
  h.expect(await h.until(() => h.js(`!!document.querySelector('[data-testid="git-branch-name"]')`), 3000), 'the New branch dialog opens')
  h.expect(await h.js(`document.querySelector('[data-testid="git-branch-base"]').value === ''`), 'base defaults to the current branch')
  h.expect(await h.js(`document.querySelector('[data-testid="git-branch-base"] option').textContent.includes('main (current)')`), 'and says which one')
  h.expect(await h.js(`document.querySelector('[data-testid="git-branch-switch"]').checked`), '"Switch to it" is ticked by default')
  await h.setValue('[data-testid="git-branch-name"]', 'my branch..')
  h.expect(await h.until(() => h.js(`/No spaces/.test(document.querySelector('[data-testid="git-branch-name-problem"]')?.textContent ?? '')`), 2000), 'an invalid name gets a hint under the field')
  h.expect(await h.js(`document.querySelector('[data-testid="git-create-branch"]').disabled`), 'and Create is disabled')
  await h.setValue('[data-testid="git-branch-name"]', 'main')
  h.expect(await h.until(() => h.js(`/already exists/.test(document.querySelector('[data-testid="git-branch-name-problem"]')?.textContent ?? '')`), 2000), 'an existing name is refused too')
  await h.wait(500)
  await h.shot('6-new-branch-invalid')
  await h.setValue('[data-testid="git-branch-name"]', 'feature/e2e')
  h.expect(await h.until(() => h.js(`!document.querySelector('[data-testid="git-branch-name-problem"]')`), 2000), 'a good name clears the hint')
  await h.click('[data-testid="git-create-branch"]')
  h.expect(await h.until(() => h.js(`!document.querySelector('[data-testid="git-branch-name"]')`), 8000), 'the dialog closes after creating')
  h.expect(branchNow() === 'feature/e2e', `git is on the new branch (${branchNow()})`)
  h.expect(await h.until(async () => (await currentRow()) === 'feature/e2e', 5000), 'the list marks the new branch current')
  h.expect((await text('.git-branch-name')) === 'feature/e2e', 'the header follows')
  await h.shot('7-created')

  // created without switching, from a remote base: listed, not current
  await h.click('[data-remote-branch="origin/main"]')
  h.expect(await h.until(() => h.js(`document.querySelector('[data-testid="git-branch-name"]')?.value === 'main'`), 3000), 'a remote branch prefills its local name')
  h.expect(await h.js(`document.querySelector('[data-testid="git-branch-base"]').value === 'origin/main'`), 'and itself as the base')
  await h.setValue('[data-testid="git-branch-name"]', 'from-remote')
  await h.click('[data-testid="git-branch-switch"]')
  await h.click('[data-testid="git-create-branch"]')
  h.expect(await h.until(() => h.js(`!!document.querySelector(${JSON.stringify(row('from-remote'))})`), 8000), 'the list shows the branch created without switching')
  h.expect(git(h.fixture, 'rev-parse', 'from-remote') === git(h.fixture, 'rev-parse', 'origin/main'), 'it starts at origin/main')
  h.expect(branchNow() === 'feature/e2e' && (await currentRow()) === 'feature/e2e', 'still on feature/e2e')

  // switch with uncommitted changes: git's error, nothing changes
  fs.writeFileSync(path.join(h.fixture, 'local.txt'), 'uncommitted\n')
  const dirtyHead = git(h.fixture, 'rev-parse', 'HEAD')
  await h.click(row('main'))
  h.expect(await h.until(() => h.js(`/local changes/.test(document.querySelector('.git-error')?.textContent ?? '')`), 8000), "a dirty tree shows git's error")
  h.expect(await h.js(`document.querySelector('.git-error')?.textContent.includes('local.txt')`), 'naming the changed file')
  h.expect(await h.js(`/Couldn't switch to main/.test(document.querySelector('.sidebar .error-banner')?.textContent ?? '')`), 'the banner says the switch failed')
  h.expect(branchNow() === 'feature/e2e' && git(h.fixture, 'rev-parse', 'HEAD') === dirtyHead, 'the branch did not change')
  h.expect(fs.readFileSync(path.join(h.fixture, 'local.txt'), 'utf8') === 'uncommitted\n', 'the change is still there')
  h.expect((await currentRow()) === 'feature/e2e', 'the list still marks feature/e2e')
  await h.shot('8-switch-dirty')

  // clean again: switch back by clicking main
  git(h.fixture, 'checkout', '--', 'local.txt')
  await h.click(row('main'))
  h.expect(await h.until(async () => (await currentRow()) === 'main', 8000), 'clicking main switches back')
  h.expect(branchNow() === 'main', 'git is on main')
  h.expect(await h.until(() => h.js(`!document.querySelector('.git-error')`), 3000), 'the old error is cleared')

  // context menu: copy name, open terminal here
  await h.js(`(() => { const r = document.querySelector(${JSON.stringify(row('main'))}).getBoundingClientRect(); document.querySelector(${JSON.stringify(row('main'))}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 5 })) })()`)
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.ctx-item')].some(e => e.textContent.includes('Copy name'))`), 2000), 'the context menu offers Copy name')
  await h.wait(500)
  await h.shot('9-branch-menu')
  const terminalsBefore = await h.js(`document.querySelectorAll('.terminal-mount').length`)
  await h.click('.ctx-item', 'Open terminal here')
  h.expect(await h.until(async () => (await h.js(`document.querySelectorAll('.terminal-mount').length`)) > terminalsBefore, 5000), 'Open terminal here opens a terminal')
  await h.shot('10-branches')

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
