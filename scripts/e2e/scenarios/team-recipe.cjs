// The built-in Software team recipe: the run form names the roles the project lacks before anything starts,
// "Add a team" installs them, then the run goes spec → build → review + qa → fix → release and waits at the pr stage.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

module.exports = async (h) => {
  await h.openFixture()
  await h.click('.activitybar button[title^="Factory"]')
  await h.wait(600)
  await h.click('.btn', 'New factory run')
  await h.wait(400)
  const opts = await h.js(`[...document.querySelectorAll('.factory-form select option')].map(o => o.textContent)`)
  h.expect(opts.includes('Software team'), 'the Software team recipe is in the library')
  await h.setValue('.factory-form select', 'Software team')
  await h.setValue('.factory-form textarea', 'Add dark mode')
  await h.wait(300)
  h.expect(await h.js(`[...document.querySelectorAll('.recipe-step')].map(s => s.textContent).join(',') === 'spec ✓,build,review,qa,fix,release,pr'`), 'the form previews the stages')
  const missing = () => h.js(`[...document.querySelectorAll('.missing-role')].map(b => b.textContent).join(',')`)
  h.expect((await missing()) === 'Product owner,QA,Release manager', 'the run form names the missing roles')
  h.expect(await h.js(`document.querySelector('.factory-form .btn.primary[type=submit]').disabled`), "Start is disabled while roles are missing")
  await h.wait(300)
  await h.shot('0-missing-roles')

  await h.click('[data-testid="missing-roles"] .btn', 'Add a team')
  h.expect(await h.until(async () => !(await h.js(`!!document.querySelector('[data-testid="missing-roles"]')`)), 8000), 'adding the team clears the notice')
  const agentsDir = path.join(h.fixture, '.sldev', 'agents')
  h.expect(['product-owner.md', 'qa.md', 'release-manager.md', 'implementer.md', 'reviewer.md'].every((f) => fs.existsSync(path.join(agentsDir, f))), 'the roles were written to .sldev/agents')
  await h.wait(300)
  await h.shot('1-team-added')
  await h.click('.factory-form .btn.primary', 'Start')

  const node = (id) => h.js(`(() => { const n = document.querySelector('.pipeline-node[data-node="${id}"]'); return n ? [...n.classList].find(c => ['pending','running','approval','done','failed'].includes(c)) : null })()`)
  const runs = () => h.js(`window.api.store.get('factoryRuns').then(s => s.runs)`)
  h.expect(await h.until(async () => (await node('spec')) === 'approval', 20000), 'the product owner writes the spec, then it waits for approval')
  await h.click('.pipeline-node[data-node="spec"] .btn.primary', 'Approve')
  h.expect(await h.until(async () => (await node('pr')) === 'approval', 90000), 'build, review and QA, fix and release run, then the pr stage waits for a click')
  await h.until(async () => (await runs())[0].nodes.pr.status === 'approval', 5000)
  const run = (await runs())[0]
  h.expect(['spec', 'build', 'review', 'qa', 'fix', 'release'].every((id) => run.nodes[id].status === 'done'), 'every agent stage finished')
  h.expect(!!run.nodes.review.worktree && !!run.nodes.qa.worktree, 'reviewer and QA ran side by side in their own worktrees')

  const all = (await h.js(`window.api.store.get('missions')`)).missions.filter((m) => m.factory?.run === run.id)
  const mission = (id) => all.find((m) => m.factory.node === id)
  // the role reaches the agent through the stage's profile: the installed file in .sldev/agents
  const role = (id) => (mission(id)?.options.profile ?? '').replace(/^project:/, '')
  const want = { spec: 'product-owner.md', build: 'implementer.md', review: 'reviewer.md', qa: 'qa.md', fix: 'implementer.md', release: 'release-manager.md' }
  h.expect(Object.entries(want).every(([id, f]) => role(id) === path.join(agentsDir, f)), 'each stage runs as its team role')
  h.expect(mission('release').prompt.includes(`${run.outDir}/fix.md`) && mission('fix').prompt.includes(`${run.outDir}/qa.md`), 'later roles read the earlier ones\' output')
  h.expect(execSync('git branch -r', { cwd: h.fixture }).toString().trim() === '', 'nothing was pushed before the pr click')
  await h.wait(500)
  await h.shot('2-pr-waiting')
}
