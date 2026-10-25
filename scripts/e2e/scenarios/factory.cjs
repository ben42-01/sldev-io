// Software Factory: a graph recipe run end to end with fake agents. Spec gate, two agents in
// parallel worktrees, fan-in merge, a check that fails once and loops back, then the PR step
// (which fails cleanly: the fixture has no remote). Also: a run pauses across a restart.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const RECIPE = `name: E2E graph
description: Spec, two parallel builders, a flaky check, a PR.
stages:
  - id: spec
    agent: codex
    prompt: Write a spec for {intent}. Save it to {out}.
    gate: approve
  - id: part-a
    needs: [spec]
    agent: claude
    prompt: Build part A from {spec.out}
  - id: part-b
    needs: [spec]
    agent: codex
    prompt: Build part B from {spec.out}
  - id: verify
    needs: [part-a, part-b]
    run: node check.js
    onFail: { retry: part-b, max: 2 }
  - id: pr
    pr: { title: "{intent}" }
`

module.exports = async (h) => {
  const marker = path.join(path.dirname(h.fixture), 'check-ran')
  fs.writeFileSync(path.join(h.fixture, 'check.js'), `const fs = require('fs')\nif (!fs.existsSync(${JSON.stringify(marker)})) { fs.writeFileSync(${JSON.stringify(marker)}, '1'); console.error('TypeError: flaky.ts:3 is not a function'); process.exit(1) }\nconsole.log('all checks green')\n`)
  execSync('git add check.js && git commit -qm "add check"', { cwd: h.fixture })
  fs.mkdirSync(path.join(h.fixture, '.sldev', 'factory'), { recursive: true })
  fs.writeFileSync(path.join(h.fixture, '.sldev', 'factory', 'e2e.yml'), RECIPE)
  await h.openFixture()

  await h.click('.activitybar button[title^="Factory"]')
  await h.wait(600)
  await h.click('.btn', 'New factory run')
  await h.wait(400)
  const opts = await h.js(`[...document.querySelectorAll('.factory-form select option')].map(o => o.textContent)`)
  h.expect(opts.includes('E2E graph (project)') && opts.includes('Feature') && opts.includes('Parallel feature'), 'project and built-in recipes are offered')
  await h.setValue('.factory-form select', '0', `e.querySelector('option')?.textContent === 'E2E graph (project)'`)
  await h.setValue('.factory-form textarea', 'Add dark mode')
  await h.wait(200)
  h.expect(await h.js(`[...document.querySelectorAll('.recipe-step')].map(s => s.textContent).join(',') === 'spec ✓,part-a,part-b,verify,pr'`), 'the form previews the steps')
  await h.shot('0-new-run')
  await h.click('.factory-form .btn.primary', 'Start')

  const node = (id) => h.js(`(() => { const n = document.querySelector('.pipeline-node[data-node="${id}"]'); return n ? [...n.classList].find(c => ['pending','running','approval','done','failed'].includes(c)) : null })()`)
  h.expect(await h.until(async () => (await node('spec')) === 'approval', 20000), 'spec runs, then waits for approval')
  const runs = () => h.js(`window.api.store.get('factoryRuns').then(s => s.runs)`)
  let run = (await runs())[0]
  h.expect(fs.existsSync(path.join(run.outDir, 'spec.md')), 'spec wrote its output file in the run folder')
  h.expect(fs.readFileSync(path.join(run.worktree.path, '.sldev', 'runs', '.gitignore'), 'utf8') === '*\n', 'run outputs are git-ignored')
  await h.shot('1-spec-approval')
  await h.click('.pipeline-node[data-node="spec"] .btn.primary', 'Approve')

  h.expect(await h.until(async () => (await node('part-a')) !== 'pending' && (await node('part-b')) !== 'pending', 10000), 'part-a and part-b start together')
  await h.until(async () => (await runs())[0].nodes['part-b'].status !== 'pending', 5000)
  run = (await runs())[0]
  h.expect(!!run.nodes['part-a'].worktree && !!run.nodes['part-b'].worktree && run.nodes['part-a'].worktree.path !== run.nodes['part-b'].worktree.path, 'parallel nodes get their own worktrees')
  await h.shot('2-parallel')

  h.expect(await h.until(async () => (await node('pr')) === 'approval', 60000), 'verify fails once, part-b retries, verify passes, PR waits for you')
  await h.until(async () => (await runs())[0].nodes.pr.status === 'approval', 5000)
  run = (await runs())[0]
  h.expect(run.nodes.verify.attempts === 2 && run.nodes['part-b'].attempts === 2 && run.nodes['part-a'].attempts === 1, 'only the retried branch ran again')
  h.expect(run.nodes['part-a'].merged, 'the parallel branch was merged into the run branch')
  h.expect(!run.nodes['part-b'].worktree, 'the retry ran alone, so in the run worktree')
  const wt = run.worktree.path
  h.expect(fs.existsSync(path.join(wt, 'changes-part-a.md')) && fs.existsSync(path.join(wt, 'codex-part-b.md')), 'the run worktree has both agents\' work')
  h.expect(fs.readFileSync(path.join(run.outDir, 'spec.md'), 'utf8').includes('fake codex'), 'later steps read the spec without overwriting it')
  h.expect(fs.existsSync(path.join(run.outDir, 'part-a.md')), 'a parallel step\'s output is copied into the run folder')
  const log = execSync('git log --oneline', { cwd: wt }).toString()
  h.expect(/factory\(part-a\)/.test(log) && /factory\(part-b\)/.test(log), 'each finished node was committed')
  const missions = (await h.js(`window.api.store.get('missions')`)).missions
  const retried = missions.find((m) => m.factory?.node === 'part-b' && m.prompt.includes('TypeError: flaky.ts:3'))
  h.expect(!!retried && retried.options.print === true, 'the retried agent got the failing check output, in print mode')
  h.expect(await h.js(`!!document.querySelector('.pipeline-edges .edge.retry')`), 'the retry loop is drawn')
  await h.wait(300)
  await h.shot('3-pr-waiting')
  h.expect(await h.js(`!!document.querySelector('.pipeline-canvas') && document.querySelector('.pipeline-canvas').getBoundingClientRect().width > 0`), 'the pipeline stays in view while steps run')

  // no remote in the fixture: pushing fails and the PR step says so instead of breaking the run
  await h.click('.pipeline-node[data-node="pr"] .btn.primary', 'Push and open PR')
  h.expect(await h.until(async () => (await h.js(`document.querySelector('.pipeline-node[data-node="pr"] .pn-note')?.textContent ?? ''`)).includes("Couldn't open the PR"), 15000), 'a failed push is reported on the PR step')

  // a restart pauses the run and never re-runs anything on its own
  await h.reload()
  await h.wait(1500)
  run = (await runs())[0]
  h.expect(run.status === 'paused' && run.nodes.pr.status === 'approval', 'after a restart the run is paused, the PR still waits')
  h.expect((await h.js(`window.api.store.get('missions')`)).missions.length === missions.length, 'no mission was started by the restart')
  await h.click('.activitybar button[title^="Factory"]')
  await h.wait(500)
  h.expect(await h.js(`document.querySelector('.run-row .run-pill')?.textContent === 'Paused'`), 'the sidebar lists the paused run')
  await h.click('.run-row')
  await h.wait(600)
  await h.shot('4-after-restart')
}
