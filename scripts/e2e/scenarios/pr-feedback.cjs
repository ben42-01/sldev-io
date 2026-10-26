// The PR feedback loop: a factory run opens a PR (pushed to a local bare "origin"), review comments
// come back from the fake gh, an agent addresses them in the run worktree, and the update is pushed
// only on a click.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const RECIPE = `name: E2E PR
description: One agent, then a PR.
stages:
  - id: build
    agent: claude
    prompt: Build {intent}
  - id: pr
    pr: { title: "{intent}" }
`

module.exports = async (h) => {
  const origin = path.join(path.dirname(h.fixture), 'origin.git')
  execSync(`git init -q --bare ${JSON.stringify(origin)} && git remote add origin ${JSON.stringify(origin)}`, { cwd: h.fixture })
  fs.mkdirSync(path.join(h.fixture, '.sldev', 'factory'), { recursive: true })
  fs.writeFileSync(path.join(h.fixture, '.sldev', 'factory', 'e2e.yml'), RECIPE)
  await h.openFixture()

  await h.click('.activitybar button[title^="Factory"]')
  await h.wait(600)
  await h.click('.btn', 'New factory run')
  await h.wait(400)
  await h.setValue('.factory-form select', '0', `e.querySelector('option')?.textContent === 'E2E PR (project)'`)
  await h.setValue('.factory-form textarea', 'Add CSV export')
  await h.wait(200)
  await h.click('.factory-form .btn.primary', 'Start')

  const runs = () => h.js(`window.api.store.get('factoryRuns').then(s => s.runs)`)
  h.expect(await h.until(async () => (await runs())?.[0]?.nodes.pr.status === 'approval', 30000), 'build runs, then the PR step waits for a click')
  h.expect(!(await h.js(`!!document.querySelector('.pr-feedback')`)), 'no feedback section before there is a PR')
  await h.click('.pipeline-node[data-node="pr"] .btn.primary', 'Push and open PR')
  h.expect(await h.until(async () => (await runs())[0].pr?.number === 12, 10000), 'the run remembers PR #12')
  const run = (await runs())[0]
  const branch = run.worktree.branch
  const pushed = () => execSync(`git log --oneline ${branch}`, { cwd: origin }).toString()
  h.expect(pushed().length > 0, 'the run branch was pushed to origin')

  h.expect(await h.until(() => h.js(`document.querySelectorAll('.pr-comments li').length === 3`), 10000), 'three comments to address (the empty approval is left out)')
  const text = await h.js(`document.querySelector('.pr-feedback').textContent`)
  h.expect(text.includes('src/app.js:1') && text.includes('Please add a test') && text.includes('keep the old log line'), 'line comment with its file and line, review and conversation comments')
  await h.shot('1-comments')

  const before = pushed()
  await h.click('.pr-feedback .btn.primary', 'Address 3 comments')
  h.expect(await h.until(async () => !!(await runs())[0].pr?.missionId, 10000), 'an agent mission starts on the comments')
  const missionId = (await runs())[0].pr.missionId
  const mission = async () => (await h.js(`window.api.store.get('missions')`)).missions.find((x) => x.id === missionId)
  await h.until(mission, 5000)
  const m = await mission()
  h.expect(m.prompt.includes('1. li:') && m.prompt.includes('maria on src/app.js:1') && m.prompt.includes('Do not push'), 'the prompt lists every comment, oldest first')
  h.expect(m.cwd === run.worktree.path, 'it works in the run worktree')

  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.pr-feedback .btn.primary')].some(b => b.textContent.includes('Push update'))`), 20000), 'when the agent is done, Push update is offered')
  h.expect(pushed() === before, 'nothing is pushed before the click')
  h.expect((await h.js(`document.querySelector('.pr-feedback').textContent`)).includes('No new review comments'), 'addressed comments are not offered again')
  await h.shot('2-ready-to-push')
  await h.click('.pr-feedback .btn.primary', 'Push update')
  h.expect(await h.until(async () => !!(await runs())[0].pr?.pushedAt, 10000), 'the update is pushed on the click')
  h.expect(/Address review feedback on #12/.test(pushed()), 'origin has the agent\'s fix on the PR branch')
  await h.shot('3-pushed')

  // the run's history, and replaying the graph as it was
  await h.click('.pipeline .panel-page-head .btn', 'History')
  await h.wait(300)
  const events = await h.js(`[...document.querySelectorAll('.run-events li .link span:last-child')].map(e => e.textContent)`)
  h.log('history', events.join(' | '))
  h.expect(events[0] === 'Run started' && events.includes('build started') && events.includes('build done') && events.includes('pr is waiting for you: Push ' + branch + ' and open a pull request into main?'), 'history lists the run and node changes')
  h.expect(['Pull request opened', 'Review comments handed to an agent', 'Update pushed to the pull request'].every((e) => events.includes(e)), 'history has the PR, the hand-over and the push')
  await h.click('.run-events .link', 'build started')
  await h.wait(300)
  const replay = await h.js(`Object.fromEntries([...document.querySelectorAll('.pipeline-node')].map(n => [n.dataset.node, n.querySelector('.pn-status').textContent]))`)
  h.expect(replay.build === 'Running' && replay.pr === 'Waiting', `replay shows the graph at that moment (${JSON.stringify(replay)})`)
  h.expect(!(await h.js(`!!document.querySelector('.pipeline-node .pn-actions')`)), 'replay is read-only')
  await h.shot('4-replay')
}
