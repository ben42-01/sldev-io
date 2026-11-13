// Git view in the left activity bar: status, Fetch and Pull (fast-forward only) against a bare remote in the temp dir.
// A diverged branch shows git's message and nothing is merged; a folder outside git gets an empty state.
// Branches: create (an invalid name gets a hint), switch, a dirty tree refuses to switch and changes nothing.
// Worktrees: listed with the main checkout marked, created by hand (new and existing branch), blocked from
// removal while a mission runs in one, removed through the confirm flow, and a gone folder pruned.
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
  await worktrees(h, git, tmp)

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

async function worktrees(h, git, tmp) {
  const wtDir = path.join(tmp, '.sldev-worktrees', path.basename(h.fixture))
  const rows = () => h.js(`[...document.querySelectorAll('.git-wt-row')].map(r => ({ path: r.dataset.path, main: !!r.dataset.main, text: r.textContent, removeDisabled: r.querySelector('[aria-label="Remove worktree"]')?.disabled ?? null }))`)
  const row = async (p) => (await rows()).find((r) => r.path === p)
  const dialog = () => h.js(`document.querySelector('dialog[open]')?.textContent ?? ''`)
  const confirmDisabled = () => h.js(`[...document.querySelectorAll('dialog[open] .btn')].find(b => b.textContent.includes('Confirm remove'))?.disabled`)
  const clickRemove = (p) => h.js(`[...document.querySelectorAll('.git-wt-row')].find(r => r.dataset.path === ${JSON.stringify(p)})?.querySelector('[aria-label="Remove worktree"]')?.click()`)
  const tick = (label) => h.js(`[...document.querySelectorAll('dialog[open] label.check')].find(l => l.textContent.includes(${JSON.stringify(label)}))?.querySelector('input').click()`)
  const openGit = async () => {
    // the activity button toggles: only click when the view isn't showing
    if (!(await h.js(`!!document.querySelector('[data-testid="git-view"]')`))) await h.click('.activity-btn[aria-label="Git"]')
    await h.until(() => h.js(`!!document.querySelector('.git-wt-row')`), 8000)
  }

  await openGit()
  let list = await rows()
  h.expect(list.length === 1 && list[0].main && list[0].path === h.fixture, `only the main checkout, marked main (${JSON.stringify(list.map((r) => r.path))})`)
  h.expect(list[0].removeDisabled === null, 'the main checkout has no Remove')

  // New worktree: a new branch as typed, from main
  await h.click('[aria-label="New worktree"]')
  h.expect(await h.until(async () => (await dialog()).includes('New worktree'), 3000), 'the New worktree dialog opens')
  await h.setValue('dialog[open] input[name=branch]', 'feature/by-hand')
  await h.wait(200)
  h.expect((await dialog()).includes(path.join('.sldev-worktrees', path.basename(h.fixture), 'feature-by-hand')), 'it says where the folder goes')
  await h.wait(400)
  await h.shot('6-new-worktree')
  await h.click('dialog[open] .btn.primary', 'Create worktree')
  const byHand = path.join(wtDir, 'feature-by-hand')
  h.expect(await h.until(() => row(byHand), 10000), 'the new worktree is listed')
  h.expect(fs.existsSync(byHand) && git(byHand, 'branch', '--show-current') === 'feature/by-hand', 'its folder is on the new branch, in .sldev-worktrees')
  h.expect(git(byHand, 'rev-parse', 'HEAD') === git(h.fixture, 'rev-parse', 'main'), 'branched from main')

  // an existing branch
  git(h.fixture, 'branch', 'already-there', 'main')
  await h.until(() => h.js(`!document.querySelector('dialog[open]')`), 3000)
  await h.wait(300)
  await h.click('[aria-label="New worktree"]')
  h.expect(await h.until(async () => (await dialog()).includes('New worktree'), 3000), 'the New worktree dialog opens again')
  await h.click('dialog[open] .seg button', 'Existing branch')
  await h.wait(300)
  h.expect(!(await h.js(`[...document.querySelectorAll('dialog[open] select[name=existing] option')].some(o => o.value === 'feature/by-hand' || o.value === 'main')`)), "branches checked out elsewhere aren't offered")
  await h.setValue('dialog[open] select[name=existing]', 'already-there')
  await h.click('dialog[open] .btn.primary', 'Create worktree')
  const existing = path.join(wtDir, 'already-there')
  h.expect(await h.until(() => row(existing), 10000), 'the existing branch got a worktree')
  h.expect(git(existing, 'branch', '--show-current') === 'already-there', 'on that branch')

  // a mission in its own worktree blocks removal while it runs
  h.key('3', ['control', 'shift'])
  await h.wait(500)
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.setValue('.form select', 'claude', `e.querySelector('option[value=claude]')`)
  await h.setValue('.form textarea', 'Worktree in use')
  await h.click('.form .btn.primary', 'Launch')
  h.expect(await h.until(async () => (await h.js(`document.querySelector('.mission-card')?.textContent ?? ''`)).includes('Ready for you'), 15000), 'mission ran and is ready')
  await openGit()
  const missionRow = await h.until(async () => (await rows()).find((r) => r.text.includes('Mission ·')), 8000)
  h.expect(!!missionRow, 'the mission shows on its worktree')
  h.expect(missionRow?.removeDisabled === true, 'Remove is disabled while the mission runs')
  h.expect(await h.js(`[...document.querySelectorAll('.git-wt-why')].some(e => e.textContent.includes('still running here'))`), 'and the row says why')
  await h.shot('7-worktrees-in-use')

  h.key('3', ['control', 'shift'])
  await h.wait(500)
  await h.click('.mission-card .icon-btn[title=Stop]')
  h.expect(await h.until(async () => !(await h.js(`!!document.querySelector('.mission-card .icon-btn[title=Stop]')`)), 8000), 'mission stopped')
  await openGit()
  h.expect(await h.until(async () => (await row(missionRow.path))?.removeDisabled === false, 5000), 'Remove is enabled once it stopped')
  await clickRemove(missionRow.path)
  h.expect(await h.until(async () => (await dialog()).includes('Remove this worktree'), 5000), 'remove asks first')
  const text = await dialog()
  h.expect(/Discard .*(modified|untracked) file/.test(text), `asks to discard the agent's uncommitted work (${text.slice(0, 160)})`)
  h.expect(await confirmDisabled(), 'confirm disabled until discard is ticked')
  h.expect(text.includes('Worktree in use') || text.includes('mission'), 'says the mission stays in its list')
  await h.wait(400)
  await h.shot('8-remove-confirm')
  await tick('Discard')
  await h.wait(200)
  h.expect(!(await confirmDisabled()), 'confirm enabled after ticking discard')
  await h.click('dialog[open] .btn', 'Confirm remove')
  h.expect(await h.until(() => !fs.existsSync(missionRow.path), 8000), "the mission's worktree folder is gone")
  h.expect(await h.until(async () => !(await row(missionRow.path)), 5000), 'and off the list')

  // a clean worktree: no discard needed, branch kept unless ticked
  await clickRemove(byHand)
  await h.until(async () => (await dialog()).includes('Remove this worktree'), 5000)
  h.expect(!(await dialog()).includes('Discard'), 'a clean worktree needs no discard')
  h.expect(!(await confirmDisabled()), 'confirm enabled straight away')
  await h.click('dialog[open] .btn', 'Confirm remove')
  h.expect(await h.until(() => !fs.existsSync(byHand), 8000), 'clean worktree removed')
  h.expect(git(h.fixture, 'branch', '--list', 'feature/by-hand') !== '', 'its branch is kept')

  // a folder deleted behind git's back: Prune
  fs.rmSync(existing, { recursive: true, force: true })
  await h.click('.sidebar-actions [aria-label="Refresh"]')
  h.expect(await h.until(async () => (await row(existing))?.text.includes('folder gone'), 5000), 'a gone folder is marked')
  await h.shot('9-prunable')
  await h.click('.git-wt-row .btn', 'Prune')
  h.expect(await h.until(async () => !(await row(existing)), 5000), 'Prune drops it from the list')
  h.expect(!git(h.fixture, 'worktree', 'list').includes('already-there'), 'and from git')
  list = await rows()
  h.expect(list.length === 1 && list[0].main, 'back to the main checkout only')
}
