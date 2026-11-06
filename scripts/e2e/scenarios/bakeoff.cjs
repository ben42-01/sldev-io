// Bake-off: the same stage on two agents in their own worktrees; keep one, the other is removed,
// and the kept branch flows on into the next stage.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const RECIPE = `name: E2E bake-off
stages:
  - id: build
    agent: [claude, codex]
    prompt: Build {intent}
  - id: verify
    run: [test?]
`

module.exports = async (h) => {
  fs.mkdirSync(path.join(h.fixture, '.sldev', 'factory'), { recursive: true })
  fs.writeFileSync(path.join(h.fixture, '.sldev', 'factory', 'bake.yml'), RECIPE)
  await h.openFixture()
  await h.click('.activitybar button[title^="Factory"]')
  await h.wait(600)
  await h.click('.btn', 'New factory run')
  await h.wait(500)
  await h.setValue('.factory-form select', 'E2E bake-off', `e.querySelector('option')?.textContent === 'E2E bake-off (project)'`)
  await h.wait(300)
  h.expect(await h.js(`document.querySelector('.recipe-checks .found')?.textContent === 'test'`), 'the form shows which checks the project has')
  await h.setValue('.factory-form textarea', 'Add a health endpoint')
  await h.click('.factory-form .btn.primary', 'Start')

  const runs = () => h.js(`window.api.store.get('factoryRuns').then(s => s.runs)`)
  h.expect(await h.until(async () => (await runs())[0]?.nodes.build.status === 'approval', 30000), 'both agents finish, then you compare')
  let run = (await runs())[0]
  const [a, b] = run.nodes.build.candidates
  h.expect(a.spec === 'claude' && b.spec === 'codex' && a.worktree.path !== b.worktree.path, 'each agent worked in its own worktree')
  h.expect(a.stats?.files > 0 && b.stats?.files > 0, 'diff stats for each version')
  h.expect(await h.js(`document.querySelectorAll('.pipeline-node[data-node="build"] .pn-candidate').length === 2`), 'the node lists both versions')
  await h.wait(300)
  await h.shot('0-compare')

  await h.click('.pipeline-node[data-node="build"] .pn-candidate:nth-child(2) .btn', 'Keep')
  h.expect(await h.until(async () => (await runs())[0]?.status === 'done', 20000), 'keeping codex lets the run finish')
  run = (await runs())[0]
  h.expect(run.nodes.build.winner === b.missionId && run.nodes.build.merged, 'the kept version was merged into the run branch')
  h.expect(fs.existsSync(path.join(run.worktree.path, 'codex-build.md')) && !fs.existsSync(path.join(run.worktree.path, 'changes-build.md')), 'the run branch has codex\'s work, not claude\'s')
  h.expect(!fs.existsSync(a.worktree.path), 'the other version\'s worktree is removed')
  h.expect(!execSync('git branch', { cwd: h.fixture }).toString().includes(a.worktree.branch), 'and its branch deleted')
  await h.shot('1-kept')
}
