// The Review tab's ship bar: a worktree mission's branch on its way into main. It says the next step
// (commit, push and open a PR, merge), shows the workflow runs on the reviewed commit (a failed one can go
// back to the agent), merges the PR on GitHub with gh pr merge pinned to the reviewed commit, and offers
// pulling main and cleaning up once merged. The list beside the diff resizes by dragging its edge.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

module.exports = async (h) => {
  const f = h.fixture
  const tmp = path.dirname(f)
  // a remote to push to, so Push & open PR really pushes
  const remote = path.join(tmp, 'origin.git')
  execSync(`git init -q --bare ${JSON.stringify(remote)} && git remote add origin ${JSON.stringify(remote)} && git push -q origin main`, { cwd: f })
  const ship = path.join(tmp, 'ship')
  fs.mkdirSync(ship)
  fs.writeFileSync(path.join(ship, 'pr.json'), '[]')
  process.env.FAKE_GH_AUTHED = '1'
  process.env.FAKE_GH_SHIP = ship

  await h.openFixture({ rightPanelVisible: true })
  const wt = await h.js(`window.api.git.addWorktree(${JSON.stringify(f)}, 'friendlier-greeting', 'main')`)
  h.expect(!!wt?.path, 'the mission has a worktree')
  fs.writeFileSync(path.join(wt.path, 'src/app.js'), "console.log('hello there, friend')\n")
  const now = Date.now()
  await h.js(`window.api.store.set('missions', { missions: [${JSON.stringify({
    id: 'm-ship1', title: 'Friendlier greeting', prompt: 'Make the greeting friendlier', brief: 'Make the greeting friendlier',
    root: f, cwd: wt.path, worktree: wt, options: { agent: 'claude' }, status: 'ended', createdAt: now - 60000, updatedAt: now - 1000
  })}] })`)
  await h.reload()
  h.key('3', ['control', 'shift'])
  await h.wait(600)
  await h.js(`document.querySelector('.mission-card [aria-label="Review changes"]')?.click()`)
  h.expect(await h.until(() => h.js(`!!document.querySelector('.ship')`), 8000), 'the Review tab has a ship bar for a worktree mission')
  h.expect(await h.js(`document.querySelector('.ship-branch')?.textContent.includes('friendlier-greeting') && document.querySelector('.ship-branch')?.textContent.includes('main')`), 'it names the branch and where it goes')
  h.expect(!(await h.js(`[...document.querySelectorAll('.diff-toolbar .btn')].some(b => /Merge into|Push & PR/.test(b.textContent))`)), 'merge and PR moved out of the toolbar')

  // 1. uncommitted work: commit first
  h.expect(await h.until(() => h.js(`document.querySelector('.ship .btn.primary')?.textContent.includes('Commit first')`), 8000), 'uncommitted work: the next step is to commit')
  h.expect(await h.js(`document.querySelector('.ship-why')?.textContent.includes('1 file not committed')`), 'and it says why')
  await h.wait(900)
  await h.shot('1-commit-first')
  await h.click('.ship .btn.primary', 'Commit first')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.diff-commit input')`), 2000), 'Commit first opens the commit form')
  await h.click('.diff-commit .btn.primary', 'Commit all')

  // 2. committed, not on GitHub: push and open a PR
  h.expect(await h.until(() => h.js(`document.querySelector('.ship .btn.primary')?.textContent.includes('Push & open PR')`), 8000), 'committed: the next step is Push & open PR')
  h.expect(await h.js(`document.querySelector('.ship-pr.none')?.textContent.includes('No PR')`), 'it says there is no PR yet')
  await h.click('.ship .btn.primary', 'Push & open PR')
  h.expect(await h.until(() => execSync(`git branch --list`, { cwd: remote }).toString().includes('friendlier-greeting'), 8000), 'the branch is pushed to origin')
  const sha = execSync('git rev-parse HEAD', { cwd: wt.path }).toString().trim()

  // 3. the PR is open and CI failed on the reviewed commit
  const prJson = (state) => JSON.stringify([{ number: 12, title: 'Friendlier greeting', state, url: 'https://github.com/acme/shop/pull/12', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: '', baseRefName: 'main', headRefOid: sha }])
  const runs = (ci, lint) => JSON.stringify([
    { databaseId: 801, displayTitle: 'Friendlier greeting', workflowName: 'CI', status: ci === 'running' ? 'in_progress' : 'completed', conclusion: ci === 'running' ? '' : ci, headBranch: wt.branch, event: 'pull_request', createdAt: new Date(now - 120000).toISOString(), url: 'https://github.com/acme/shop/actions/runs/801', number: 9, headSha: sha },
    { databaseId: 802, displayTitle: 'Friendlier greeting', workflowName: 'Lint', status: 'completed', conclusion: lint, headBranch: wt.branch, event: 'pull_request', createdAt: new Date(now - 110000).toISOString(), url: 'https://github.com/acme/shop/actions/runs/802', number: 10, headSha: sha },
    { databaseId: 790, displayTitle: 'older', workflowName: 'CI', status: 'completed', conclusion: 'failure', headBranch: wt.branch, event: 'pull_request', createdAt: new Date(now - 900000).toISOString(), url: 'u', number: 8, headSha: 'deadbeef' }
  ])
  fs.writeFileSync(path.join(ship, 'pr.json'), prJson('OPEN'))
  fs.writeFileSync(path.join(ship, 'runs.json'), runs('failure', 'success'))
  await h.click('.ship [aria-label="Refresh the pull request and checks"]')
  h.expect(await h.until(() => h.js(`document.querySelector('.ship-pr.open')?.textContent.includes('#12')`), 8000), 'the open PR shows with its number')
  h.expect(await h.until(() => h.js(`document.querySelector('.ship-checks .spill.tone-error')?.textContent.includes('1 failed')`), 4000), 'a failed check on the reviewed commit shows red (the older run is ignored)')
  h.expect(await h.js(`document.querySelector('.ship-why')?.textContent.includes('1 check failed')`), 'and says why merging is a bad idea')
  h.expect(await h.js(`!document.querySelector('.ship-split .btn.primary')`), 'merge is not the primary button while a check fails')
  await h.click('.ship-checks')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.ship-run').length === 2`), 2000), 'the runs list shows the newest run of each workflow')
  h.expect(await h.js(`[...document.querySelectorAll('.ship-run .btn')].some(b => b.textContent.includes('Fix with Claude Code'))`), 'a failed run can go back to the agent')
  await h.wait(900)
  await h.shot('2-checks-failed')

  // the line under the GitHub part drags up and down: taller runs list, and dragged up, closed
  const runsH = () => h.js(`document.querySelector('.ship-runs')?.getBoundingClientRect().height ?? 0`)
  const drag = async (sel, dy) => {
    const p = await h.js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(b.x + 400), y: Math.round(b.y + b.height / 2) } })()`)
    h.mouse({ type: 'mouseMove', x: p.x, y: p.y })
    h.mouse({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= 6; i++) {
      h.mouse({ type: 'mouseMove', x: p.x, y: p.y + Math.round((dy * i) / 6), button: 'left', modifiers: ['leftButtonDown'] })
      await h.wait(30)
    }
    h.mouse({ type: 'mouseUp', x: p.x, y: p.y + dy, button: 'left', clickCount: 1 })
    await h.wait(300)
  }
  const h0 = await runsH()
  await drag('.ship-divider', 160)
  const h1 = await runsH()
  h.expect(h1 > h0 + 120, `dragging the line under the ship bar down makes the runs taller (${h0} → ${h1})`)
  h.expect(((await h.js(`window.api.settings.get()`)).shipRunsHeight ?? 0) > h0 + 120, 'and the height is kept')
  await h.wait(600)
  await h.shot('2b-runs-taller')
  await drag('.ship-divider', -h1 - 40)
  h.expect(await h.until(() => h.js(`!document.querySelector('.ship-runs')`), 2000), 'dragged all the way up, the runs list closes')
  await drag('.ship-divider', 120)
  h.expect(await h.until(() => h.js(`!!document.querySelector('.ship-runs')`), 2000), 'dragged down again, it opens')

  // 4. CI passes: merge
  fs.writeFileSync(path.join(ship, 'runs.json'), runs('success', 'success'))
  await h.click('.ship [aria-label="Refresh the pull request and checks"]')
  h.expect(await h.until(() => h.js(`document.querySelector('.ship-why.ready')?.textContent.includes('Ready to merge')`), 8000), 'checks passed: ready to merge')
  h.expect(await h.js(`document.querySelector('.ship-split .btn.primary')?.textContent.includes('Squash & merge')`), 'Squash & merge is the next step')
  await h.wait(900)
  await h.shot('3-ready-to-merge')
  await h.click('.ship-split .btn.primary', 'Squash & merge')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('dialog[open]')].some(d => d.textContent.includes('Merge #12 into main'))`), 3000), 'merging asks first')
  await h.wait(600)
  await h.shot('4-merge-confirm')
  await h.click('dialog[open] .btn.primary', 'Merge')
  h.expect(await h.until(() => fs.existsSync(path.join(ship, 'merge.txt')), 8000), 'gh pr merge ran')
  const merged = fs.existsSync(path.join(ship, 'merge.txt')) ? fs.readFileSync(path.join(ship, 'merge.txt'), 'utf8') : ''
  h.expect(merged.includes('pr merge 12 --squash') && merged.includes(`--match-head-commit ${sha}`), `it merged #12, pinned to the reviewed commit (${merged.trim()})`)
  h.expect(await h.until(() => h.js(`document.querySelector('.ship-pr.merged')?.textContent.includes('Merged')`), 8000), 'the bar says merged')
  h.expect(await h.js(`[...document.querySelectorAll('.ship .btn')].some(b => b.textContent.includes('Pull main')) && [...document.querySelectorAll('.ship .btn')].some(b => b.textContent.includes('Clean up'))`), 'then offers pulling main and cleaning up')
  await h.wait(900)
  await h.shot('5-merged')

  // 5. the list beside the diff resizes
  await h.click('.diff-toolbar .seg button', 'All files')
  await h.until(() => h.js(`!!document.querySelector('.diff-files')`), 4000)
  const width = () => h.js(`document.querySelector('.diff-files').getBoundingClientRect().width`)
  const before = await width()
  const r = await h.js(`(() => { const b = document.querySelector('.pane-resizer').getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + 80) } })()`)
  h.mouse({ type: 'mouseMove', x: r.x, y: r.y })
  h.mouse({ type: 'mouseDown', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 6; i++) {
    h.mouse({ type: 'mouseMove', x: r.x + i * 25, y: r.y, button: 'left', modifiers: ['leftButtonDown'] })
    await h.wait(30)
  }
  h.mouse({ type: 'mouseUp', x: r.x + 150, y: r.y, button: 'left', clickCount: 1 })
  await h.wait(300)
  const after = await width()
  h.expect(after > before + 100, `dragging the divider widens the file list (${before} → ${after})`)
  h.expect(await h.until(async () => ((await h.js(`window.api.settings.get()`)).reviewListWidth ?? 0) > before + 100, 3000), 'and the width is kept in settings')
  await h.click('.diff-toolbar .seg button', 'Walkthrough')
  h.expect(await h.until(async () => Math.abs((await h.js(`document.querySelector('.rc-parts')?.getBoundingClientRect().width ?? 0`)) - after) < 2, 3000), 'the walkthrough list has the same width')
  await h.wait(900)
  await h.shot('6-walkthrough-wider-list')
}
