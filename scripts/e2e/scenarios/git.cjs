// Git view in the left activity bar: status, Fetch and Pull (fast-forward only) against a bare remote in the temp dir.
// A diverged branch shows git's message and nothing is merged; a folder outside git gets an empty state.
// Branches: create (an invalid name gets a hint), switch, a dirty tree refuses to switch and changes nothing.
// Worktrees: listed with the main checkout marked, created by hand (new and existing branch), blocked from
// removal while a mission runs in one, removed through the confirm flow, and a gone folder pruned.
// GitHub stats panel: from the palette with gh logged out and missing (local tiles + Set up gh), then from the
// Git view header with gh logged in (every tile, CI runs in status tones); it reads only while it's on screen.
// Activity charts: commits per day/week with merges, matching `git log --since` for 7, 30 and 90 days; the PR chart
// hides with a note without gh and shows opened vs merged with it.
// Commit graph: a merged PR branch and a tag in their own lanes with chips, PR links, paging through 650+ commits
// with only the rows in view drawn, and a row opening its commit diff.
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

  // ── GitHub stats panel ──
  const stats = (sel) => h.js(`document.querySelector('[data-testid="github-stats"] ${sel}')?.textContent ?? ''`)
  const ghLog = path.join(tmp, 'gh-calls.log')
  const ghCalls = () => (fs.existsSync(ghLog) ? fs.readFileSync(ghLog, 'utf8') : '')

  // gh installed but logged out (the fake's default): local tiles, and a hint to set gh up
  h.key('P', ['control', 'shift'])
  await h.wait(400)
  h.type('github stats')
  await h.wait(300)
  h.expect(await h.js(`document.querySelector('.palette .palette-item')?.textContent.includes('GitHub stats')`), 'the palette offers Git: GitHub stats')
  h.key('Enter')
  h.expect(await h.until(() => h.js(`!!document.querySelector('[data-testid="ghs-branch"]')`), 10000), 'the stats panel opens from the palette')
  h.expect((await stats('[data-testid="ghs-setup"]')).includes('gh auth login'), `logged out: asks to log in (${await stats('[data-testid="ghs-setup"]')})`)
  h.expect((await stats('[data-testid="ghs-branch"] b')) === 'main', 'the branch tile reads git')
  h.expect((await stats('[data-testid="ghs-commit"]')).includes('local work'), 'the last commit reads git')
  h.expect(!(await h.js(`!!document.querySelector('[data-testid="ghs-prs"], [data-testid="ghs-runs"]')`)), 'no GitHub tiles without gh')
  h.expect(await h.until(() => h.js(`!!document.querySelector('[data-testid="ghs-commits-chart"] .ghs-chart svg')`), 8000), 'the commit chart shows without gh')
  h.expect((await stats('[data-testid="ghs-prs-note"]')).includes('gh auth login'), `the PR chart is a note without gh (${await stats('[data-testid="ghs-prs-chart"]')})`)
  h.expect(!(await h.js(`!!document.querySelector('[data-testid="ghs-prs-chart"] .ghs-chart svg')`)), 'and draws no PR bars')
  await h.wait(300)
  await h.shot('10-stats-logged-out')

  // gh not installed: same local tiles, the hint says so
  process.env.FAKE_GH_MISSING = '1'
  await h.click('[data-testid="github-stats"] .ghs-head [aria-label="Refresh"]')
  h.expect(await h.until(async () => (await stats('[data-testid="ghs-setup"]')).includes('not installed'), 8000), `gh missing: says it isn't installed (${await stats('[data-testid="ghs-setup"]')})`)
  h.expect((await stats('[data-testid="ghs-branch"] b')) === 'main', 'and still shows the branch')
  await h.shot('11-stats-no-gh')

  // Set up gh opens the setup check; the stats tab is hidden behind it and reads nothing
  await h.click('[data-testid="ghs-setup"] .btn', 'Set up gh')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.dv-tab.dv-active-tab')].some(t => t.textContent.includes('Setup'))`), 5000), 'Set up gh opens the setup check')
  delete process.env.FAKE_GH_MISSING
  process.env.FAKE_GH_AUTHED = '1'
  process.env.FAKE_GH_LOG = ghLog
  await h.wait(2500)
  h.expect(!ghCalls().includes('release list'), 'a hidden stats tab asks GitHub nothing')

  // logged in, opened from the Git view header: every tile, and it reads again on show
  if (!(await h.js(`!!document.querySelector('[data-testid="git-view"]')`))) await h.click('.activity-btn[aria-label="Git"]')
  await h.until(() => h.js(`!!document.querySelector('[data-testid="git-view"]')`), 5000)
  h.expect(await h.click('.sidebar-actions [aria-label="GitHub stats"]'), 'the Git view header has a GitHub stats button')
  h.expect(await h.until(async () => (await stats('[data-testid="ghs-prs"] b')) === '4', 10000), `open PRs tile (${await stats('[data-testid="ghs-prs"]')})`)
  h.expect(ghCalls().includes('release list'), 'showing the tab read GitHub again')
  h.expect((await stats('[data-testid="ghs-issues"] b')) === '17', 'open issues tile')
  h.expect((await stats('[data-testid="ghs-release"] b')) === 'v2.3.0', 'latest release tile')
  h.expect((await stats('[data-testid="ghs-prs"]')).includes('2 PRs for main'), "counts this branch's PRs")
  h.expect((await stats('.ghs-repo')).includes('acme/shop'), 'names the repo')
  h.expect(!(await h.js(`!!document.querySelector('[data-testid="ghs-setup"]')`)), 'no setup hint once gh works')
  const tones = await h.js(`[...document.querySelectorAll('[data-testid="ghs-runs"] .ghs-run > .sdot')].map(d => [...d.classList].find(c => c.startsWith('tone-')))`)
  h.expect(JSON.stringify(tones) === JSON.stringify(['tone-working', 'tone-error', 'tone-done']), `CI runs in status tones (${tones})`)
  h.expect((await stats('[data-testid="ghs-branch-prs"]')).includes('Draft'), 'a draft PR is marked')
  await h.wait(300)
  await h.shot('12-stats')

  // ── Activity charts ──
  // backdated commits (3, 20 and 60 days ago) and a merge today, then a PR history for the fake gh
  const day = 86_400_000
  const backdated = (file, ago) => {
    const when = new Date(Date.now() - ago * day).toISOString()
    fs.writeFileSync(path.join(h.fixture, file), `${file}\n`)
    git(h.fixture, 'add', file)
    execFileSync('git', [...ID, 'commit', '-qm', `add ${file}`], { cwd: h.fixture, env: { ...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } })
  }
  const head = git(h.fixture, 'rev-parse', '--abbrev-ref', 'HEAD')
  backdated('old-60.txt', 60)
  backdated('old-20.txt', 20)
  backdated('old-3.txt', 3)
  git(h.fixture, 'checkout', '-qb', 'e2e-side')
  backdated('side.txt', 0)
  git(h.fixture, 'checkout', '-q', head)
  git(h.fixture, ...ID, 'merge', '-q', '--no-ff', '-m', 'Merge e2e-side', 'e2e-side')
  const iso = (ago) => new Date(Date.now() - ago * day).toISOString()
  process.env.FAKE_GH_ACTIVITY = JSON.stringify([
    { number: 140, createdAt: iso(2), mergedAt: iso(1), closedAt: iso(1) },
    { number: 141, createdAt: iso(1), mergedAt: null, closedAt: null },
    { number: 142, createdAt: iso(0), mergedAt: iso(0), closedAt: iso(0) },
    { number: 120, createdAt: iso(40), mergedAt: iso(25), closedAt: iso(25) }
  ])
  await h.click('[data-testid="github-stats"] .ghs-head [aria-label="Refresh"]')

  const localDay = (ago) => {
    const d = new Date(Date.now() - ago * day)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const chart = (sel) => h.js(`[...document.querySelectorAll('[data-testid="${sel}"] svg g[data-key]')].map(g => g.dataset.values.split(',').map(Number))`)
  for (const days of [7, 30, 90]) {
    await h.click(`[data-testid="ghs-activity"] [data-days="${days}"]`)
    const since = `--since=${localDay(days - 1)} 00:00:00`
    const want = Number(git(h.fixture, 'rev-list', '--count', since, 'HEAD'))
    const wantMerges = Number(git(h.fixture, 'rev-list', '--count', '--merges', since, 'HEAD'))
    const ok = await h.until(async () => (await stats('[data-testid="ghs-commits-total"]')).startsWith(`${want} commit`), 8000)
    h.expect(ok, `${days} days: ${want} commits like git log (${await stats('[data-testid="ghs-commits-total"]')})`)
    const bars = await chart('ghs-commits-chart')
    h.expect(bars.length === (days === 90 ? 13 : days) || (days === 90 && bars.length === 14), `${days} days: one bar per ${days === 90 ? 'week' : 'day'} (${bars.length})`)
    h.expect(bars.reduce((t, [c, m]) => t + c + m, 0) === want, `${days} days: the bars add up to git's count`)
    h.expect(bars.reduce((t, [, m]) => t + m, 0) === wantMerges, `${days} days: ${wantMerges} merge(s) highlighted`)
    h.expect(await h.js(`!!document.querySelector('[data-testid="ghs-commits-chart"] .ghs-bar.merge')`), `${days} days: the merge bar is drawn`)
    const prs = await chart('ghs-prs-chart')
    const opened = prs.reduce((t, [o]) => t + o, 0)
    const merged = prs.reduce((t, [, m]) => t + m, 0)
    const wantOpened = days === 90 ? 4 : 3
    const wantMergedPrs = days === 90 || days === 30 ? 3 : 2
    h.expect(opened === wantOpened && merged === wantMergedPrs, `${days} days: PRs ${opened} opened / ${merged} merged (want ${wantOpened}/${wantMergedPrs})`)
    await h.js(`document.querySelector('[data-testid="ghs-activity"]').scrollIntoView({ block: 'start' })`)
    await h.wait(800)
    await h.shot(`13-activity-${days}`)
  }
  h.expect(!(await h.js(`!!document.querySelector('[data-testid="ghs-prs-note"]')`)), 'no gh note once gh works')
  // hover a column: its numbers in the readout
  await h.js(`document.querySelector('[data-testid="ghs-commits-chart"] svg g[data-key]:last-of-type .ghs-hit').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`)
  h.expect(await h.until(async () => /merge/.test(await stats('[data-testid="ghs-commits-chart"] .ghs-readout')), 3000), `hover shows a week's numbers (${await stats('[data-testid="ghs-commits-chart"] .ghs-readout')})`)
  await h.wait(800)
  await h.shot('14-activity-hover')
  delete process.env.FAKE_GH_ACTIVITY
  // ── Commit graph ──
  // a branch merged as PR #7 and a tag, made in a worktree of their own so the fixture's checkout is left alone,
  // plus 650 old commits on an unrelated branch (one fast-import) to page through
  const gwt = path.join(tmp, 'graph-wt')
  git(h.fixture, 'worktree', 'add', '-q', '-b', 'release/graph', gwt, 'HEAD')
  const commitIn = (file, msg) => {
    fs.writeFileSync(path.join(gwt, file), `${file}\n`)
    git(gwt, 'add', file)
    git(gwt, ...ID, 'commit', '-qm', msg)
  }
  git(gwt, 'switch', '-qc', 'feature/graph')
  commitIn('graph.txt', 'draw the graph')
  git(gwt, 'switch', '-q', 'release/graph')
  commitIn('other.txt', 'meanwhile on release')
  git(gwt, ...ID, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #7 from acme/feature-graph', 'feature/graph')
  git(gwt, 'tag', 'v-e2e')
  let stream = ''
  for (let i = 1; i <= 650; i++) {
    const msg = `old commit ${i}`
    stream += `commit refs/heads/long-history\nmark :${i}\ncommitter e2e <e2e@example.com> ${1600000000 + i * 60} +0000\ndata ${msg.length}\n${msg}\n${i > 1 ? `from :${i - 1}\n` : ''}\n`
  }
  execFileSync('git', ['fast-import', '--quiet'], { cwd: h.fixture, input: stream })

  const opened = []
  const { shell } = require('electron')
  const realOpen = shell.openExternal
  shell.openExternal = async (url) => void opened.push(url)

  if (!(await h.js(`!!document.querySelector('[data-testid="git-view"]')`))) await h.click('.activity-btn[aria-label="Git"]')
  await h.until(() => h.js(`!!document.querySelector('[data-testid="git-view"]')`), 5000)
  h.expect(await h.click('.sidebar-actions [aria-label="Commit graph"]'), 'the Git view header has a Commit graph button')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('[data-testid="commit-graph"] .cg-row').length > 5`), 10000), 'the graph tab opens with commits')
  const graphRow = (subject) =>
    h.js(`(() => { const r = [...document.querySelectorAll('.cg-row')].find(r => r.querySelector('.cg-subject')?.textContent === ${JSON.stringify(subject)}); if (!r) return null
      const n = r.querySelector('circle.cg-node'); return { refs: [...r.querySelectorAll('.cg-ref')].map(c => c.textContent), pr: r.querySelector('.cg-pr')?.textContent ?? '', cx: Number(n.getAttribute('cx')), merge: n.classList.contains('merge'), sha: r.dataset.sha } })()`)
  const merge = await graphRow('Merge pull request #7 from acme/feature-graph')
  const feature = await graphRow('draw the graph')
  const release = await graphRow('meanwhile on release')
  h.expect(!!merge && merge.refs.includes('release/graph') && merge.refs.includes('v-e2e'), `the merge carries its branch and tag chips (${JSON.stringify(merge?.refs)})`)
  h.expect(merge?.merge && merge.pr === '#7', `a merge is a ring with its PR (${JSON.stringify(merge)})`)
  h.expect(!!feature && feature.refs.includes('feature/graph'), `the feature branch has its chip (${JSON.stringify(feature?.refs)})`)
  h.expect(!!feature && !!release && feature.cx !== release.cx && release.cx === merge.cx, `the merged branch runs in its own lane (${feature?.cx}, ${release?.cx}, ${merge?.cx})`)
  h.expect(await h.js(`[...document.querySelectorAll('.cg-ref.head')].some(c => c.textContent === ${JSON.stringify(git(h.fixture, 'rev-parse', '--abbrev-ref', 'HEAD'))})`), 'the checked-out branch is marked')
  const textOf = (sel) => h.js(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`)
  const foot = () => textOf('[data-testid="commit-graph"] .cg-foot')
  h.expect((await foot()).startsWith('300 commits') && (await foot()).includes('more load'), `the first page is 300 commits (${await foot()})`)
  const drawn = await h.js(`document.querySelectorAll('.cg-row').length`)
  h.expect(drawn < 120, `only the rows in view are drawn (${drawn} of 300)`)
  await h.wait(600)
  await h.shot('13-graph')

  // the PR opens on GitHub; a row opens the commit's diff
  await h.click('.cg-row .cg-pr', '#7')
  h.expect(await h.until(() => opened.includes('https://github.com/acme/shop/pull/7'), 3000), `#7 opens the PR on GitHub (${opened})`)
  await h.click('.cg-row .cg-sha')
  h.expect(await h.until(() => h.js(`document.querySelector('.toast')?.textContent.includes('Copied')`), 3000), `the sha is copied (${await textOf('.toast')})`)

  // scrolling to the end loads the next page, then the rest
  for (let i = 0; i < 6; i++) {
    await h.js(`(() => { const s = document.querySelector('.cg-scroll'); s.scrollTop = s.scrollHeight })()`)
    await h.wait(500)
  }
  h.expect(await h.until(async () => (await foot()).includes('all of them'), 8000), `scrolling loads every page (${await foot()})`)
  const total = Number(git(h.fixture, 'rev-list', '--all', '--count'))
  h.expect((await foot()).startsWith(`${total} commits`), `all ${total} commits listed (${await foot()})`)
  h.expect((await h.js(`document.querySelectorAll('.cg-row').length`)) < 120, 'still only the rows in view are drawn')
  h.expect(await h.js(`[...document.querySelectorAll('.cg-row .cg-subject')].some(s => s.textContent === 'old commit 1')`), 'the oldest commit is at the bottom')
  await h.wait(400)
  await h.shot('14-graph-end')

  await h.js(`document.querySelector('.cg-scroll').scrollTop = 0`)
  await h.wait(400)
  await h.js(`[...document.querySelectorAll('.cg-row')].find(r => r.dataset.sha === ${JSON.stringify(feature?.sha)})?.click()`)
  h.expect(await h.until(() => h.js(`document.querySelector('[data-testid="commit-panel"] .diff-file-path')?.textContent === 'graph.txt'`), 8000), 'a row opens its commit diff')
  h.expect((await textOf('[data-testid="commit-panel"] .commit-panel-subject')) === 'draw the graph', 'the diff names the commit')
  await h.wait(600)
  await h.shot('15-commit-diff')
  shell.openExternal = realOpen

  // ── Long branch lists: local and remote folds, the 25 most recent, search for the rest; Worktrees folds too ──
  for (let i = 1; i <= 30; i++) git(h.fixture, 'branch', `bulk/b${String(i).padStart(2, '0')}`)
  if (!(await h.js(`!!document.querySelector('[data-testid="git-view"]')`))) await h.click('.activity-btn[aria-label="Git"]')
  await h.until(() => h.js(`!!document.querySelector('[data-testid="git-view"]')`), 5000)
  await h.click('.sidebar-actions [aria-label="Refresh"]')
  const localRows = () => h.js(`document.querySelectorAll('[data-group="local"] .git-branch-row').length`)
  const localTotal = git(h.fixture, 'for-each-ref', '--format=%(refname)', 'refs/heads').split('\n').length
  h.expect(await h.until(() => h.js(`!!document.querySelector('[data-branch="bulk/b30"]') || !!document.querySelector('[data-branch="bulk/b01"]')`), 8000), 'the new branches are listed')
  h.expect((await localRows()) <= 26, `only the 25 most recent (+ the current one) are drawn (${await localRows()} of ${localTotal})`)
  h.expect(await h.js(`/older branch.*hidden/.test(document.querySelector('[data-group="local"] .git-more')?.textContent ?? '')`), 'says older ones are hidden')
  h.expect(await h.js(`!!document.querySelector('[data-group="local"] .git-branch-row.current')`), 'the current branch is always there')
  await h.wait(400)
  await h.shot('16-branches-capped')

  await h.setValue('[data-testid="git-branch-search"]', 'b07')
  h.expect(await h.until(async () => (await localRows()) === 1, 3000), `search finds an older branch (${await localRows()})`)
  h.expect(await h.js(`!!document.querySelector('[data-branch="bulk/b07"]')`), 'the one asked for')
  h.expect(await h.js(`!document.querySelector('[data-group="remote"] .git-branch-row')`), 'a remote group without matches stays shut')
  await h.setValue('[data-testid="git-branch-search"]', 'origin main')
  h.expect(await h.until(() => h.js(`!!document.querySelector('[data-remote-branch="origin/main"]')`), 3000), 'searching opens the remote group for a match')
  await h.wait(400)
  await h.shot('17-branches-search')
  await h.setValue('[data-testid="git-branch-search"]', '')

  await h.click('[data-testid="git-local-all"]')
  h.expect(await h.until(async () => (await localRows()) === localTotal, 3000), `Show all lists every local branch (${await localRows()} of ${localTotal})`)
  await h.click('[data-testid="git-local-toggle"]')
  h.expect(await h.until(async () => (await localRows()) === 0, 3000), 'Local folds shut')
  await h.click('[data-testid="git-worktrees-toggle"]')
  h.expect(await h.until(() => h.js(`!document.querySelector('.git-wt-row') && document.querySelector('[data-testid="git-worktrees-toggle"]').getAttribute('aria-expanded') === 'false'`), 3000), 'Worktrees fold shut')
  h.expect(/\d/.test(await textOf('[data-testid="git-worktrees-toggle"] .git-count')), 'and still says how many there are')
  await h.wait(400)
  await h.shot('18-folded')
  await h.click('[data-testid="git-local-toggle"]')
  await h.click('[data-testid="git-worktrees-toggle"]')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.git-wt-row')`), 3000), 'Worktrees open again')
  delete process.env.FAKE_GH_AUTHED
  delete process.env.FAKE_GH_LOG
}
