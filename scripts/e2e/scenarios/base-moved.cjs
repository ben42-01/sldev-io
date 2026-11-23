// The ship bar says when the base moved since the branch left it, before anything is pushed: the new commits
// on main, and a trial merge's conflicting files. Update and check (a click) merges main into the mission's
// worktree, runs the project's typecheck and test there and reports pass/fail; a conflict leaves the worktree
// as it was. A clean merge that no longer builds can go back to the agent with the failing output.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

module.exports = async (h) => {
  const f = h.fixture
  const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
  const commit = (cwd, files, msg) => {
    for (const [p, text] of Object.entries(files)) fs.writeFileSync(path.join(cwd, p), text)
    git(cwd, 'add', '-A')
    git(cwd, 'commit', '-q', '-m', msg)
  }
  // a project check that only passes while lib.js exports greet
  const pkg = JSON.parse(fs.readFileSync(path.join(f, 'package.json'), 'utf8'))
  pkg.scripts.typecheck = 'node check.js'
  commit(f, {
    'package.json': JSON.stringify(pkg, null, 2),
    'check.js': "const lib = require('./lib.js')\nif (typeof lib.greet !== 'function') { console.error('check.js: lib.greet is not a function (it was renamed?)'); process.exit(2) }\nconsole.log('check ok')\n",
    'lib.js': "exports.greet = (n) => 'hello ' + n\n"
  }, 'Add a check')
  const main = git(f, 'rev-parse', '--abbrev-ref', 'HEAD')

  await h.openFixture({ rightPanelVisible: true })
  const wt = await h.js(`window.api.git.addWorktree(${JSON.stringify(f)}, 'base-moved', ${JSON.stringify(main)})`)
  h.expect(!!wt?.path, 'the mission has a worktree')
  commit(wt.path, { 'src/app.js': "console.log(require('../lib.js').greet('friend'))\n" }, 'Use greet')
  const now = Date.now()
  await h.js(`window.api.store.set('missions', { missions: [${JSON.stringify({
    id: 'm-base1', title: 'Greet a friend', prompt: 'Greet a friend', brief: 'Greet a friend',
    root: f, cwd: wt.path, worktree: wt, options: { agent: 'claude' }, status: 'ended', createdAt: now - 60000, updatedAt: now - 1000
  })}] })`)
  await h.reload()
  h.key('3', ['control', 'shift'])
  await h.wait(600)
  await h.js(`document.querySelector('.mission-card [aria-label="Review changes"]')?.click()`)
  h.expect(await h.until(() => h.js(`!!document.querySelector('.ship')`), 8000), 'the Review tab has a ship bar')
  await h.wait(1500)
  h.expect(!(await h.js(`!!document.querySelector('.ship-base')`)), 'nothing about the base while it has not moved')
  const refresh = () => h.click('.ship [aria-label="Refresh the pull request and checks"]')
  const baseText = () => h.js(`document.querySelector('.ship-base')?.textContent ?? ''`)

  // 1. main moves in the same file: the trial merge names it, and Update and check leaves the worktree alone
  commit(f, { 'src/app.js': "console.log('hello from main')\n" }, 'Change the greeting (#30)')
  await refresh()
  h.expect(await h.until(async () => (await baseText()).includes(`${main} has 1 new commit since this branch: #30 Change the greeting`), 8000), `the base moved line names the commit (${await baseText()})`)
  h.expect(await h.until(async () => (await baseText()).includes('conflicts in src/app.js'), 4000), 'the trial merge names the conflicting file')
  const before = git(wt.path, 'rev-parse', 'HEAD')
  h.expect(git(wt.path, 'status', '--porcelain') === '', 'the trial merge did not touch the worktree')
  await h.wait(800)
  await h.shot('1-conflicts')
  await h.click('.ship-base .btn', 'Update and check')
  h.expect(await h.until(() => h.js(`document.querySelector('[data-testid="ship-update"]')?.textContent.includes('the merge was undone')`), 8000), 'a conflicting update says the merge was undone')
  h.expect(git(wt.path, 'rev-parse', 'HEAD') === before && git(wt.path, 'status', '--porcelain') === '', 'and the worktree is as it was')
  await h.click('.ship-update [aria-label="Hide the update result"]')

  // 2. main moves again, cleanly, but breaks the check: Update and check reports the failure
  git(f, 'reset', '-q', '--hard', 'HEAD~1')
  commit(f, { 'lib.js': "exports.hello = (n) => 'hello ' + n\n" }, 'Rename greet to hello (#31)')
  await refresh()
  h.expect(await h.until(async () => (await baseText()).includes('#31 Rename greet to hello') && (await baseText()).includes('merges without conflicts'), 8000), `a clean trial merge (${await baseText()})`)
  h.expect(git(wt.path, 'rev-parse', 'HEAD') === before, 'nothing merged without a click')
  await h.wait(800)
  await h.shot('2-base-moved')
  await h.click('.ship-base .btn', 'Update and check')
  h.expect(await h.until(() => h.js(`document.querySelector('[data-testid="ship-update"]')?.textContent.includes('typecheck failed')`), 30000), 'Update and check reports the failing typecheck')
  h.expect(await h.js(`document.querySelector('.ship-update .ship-error')?.textContent.includes('lib.greet is not a function')`), 'with the failing output')
  h.expect(await h.js(`[...document.querySelectorAll('.ship-check')].some(c => c.textContent.includes('test') && c.textContent.includes('passed'))`), 'the test script ran and passed')
  h.expect(git(wt.path, 'log', '-1', '--format=%P').split(' ').length === 2, 'the base was merged into the worktree (a local merge commit)')
  h.expect(await h.until(() => h.js(`![...document.querySelectorAll('.ship-base-line')].some(l => l.textContent.includes('new commit'))`), 5000), 'the branch is no longer behind')
  await h.wait(800)
  await h.shot('3-update-failed')

  // 3. Send back gives the mission's agent the output; while it works, Update and check isn't offered
  await h.click('.ship-update .btn', 'Send back')
  h.expect(await h.until(async () => {
    const list = (await h.js(`window.api.store.get('missions')`))?.missions ?? []
    return list.some((x) => x.parent?.id === 'm-base1' && x.cwd === wt.path && String(x.brief).includes('no longer builds') && String(x.brief).includes('lib.greet is not a function'))
  }, 8000), 'Send back started a follow-up in the worktree with the failing output')
  commit(f, { 'README.md': 'more\n' }, 'Another change (#32)')
  await refresh()
  h.expect(await h.until(async () => (await baseText()).includes('#32'), 8000), 'the base moved again')
  const disabled = await h.until(() => h.js(`[...document.querySelectorAll('.ship-base .btn')].find(b => b.textContent.includes('Update and check'))?.disabled === true`), 8000)
  h.expect(disabled, 'Update and check is disabled while the agent works in the worktree')
  await h.wait(600)
  await h.shot('4-agent-working')
}
