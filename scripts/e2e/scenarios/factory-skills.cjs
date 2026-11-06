// Factory: a stage that runs the project's own skill, a per-run agent override, and a run that
// starts from a spec file instead of writing one.
const fs = require('fs')
const os = require('os')
const path = require('path')

const log = path.join(os.tmpdir(), `sldev-e2e-fskills-${process.pid}.jsonl`)
const RECIPE = `name: House flow
description: Our spec skill, then a build.
stages:
  - id: spec
    skill: house-spec
  - id: build
    agent: claude
    prompt: Build what {spec.out} says
`

module.exports = async (h) => {
  fs.rmSync(log, { force: true })
  const skillDir = path.join(h.fixture, '.sldev', 'skills', 'house-spec')
  fs.mkdirSync(skillDir, { recursive: true })
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: house-spec\ndescription: Our spec format\n---\n\nWrite the spec in our format.\n')
  fs.mkdirSync(path.join(h.fixture, '.sldev', 'factory'), { recursive: true })
  fs.writeFileSync(path.join(h.fixture, '.sldev', 'factory', 'house.yml'), RECIPE)
  fs.mkdirSync(path.join(h.fixture, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(h.fixture, 'docs', 'spec.md'), '# Dark mode spec\n\nA toggle in settings.\n')
  await h.openFixture({ defaultAgent: 'claude' })

  const argvs = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
  const runs = () => h.js(`window.api.store.get('factoryRuns').then(s => s?.runs ?? [])`)
  const open = async () => {
    await h.click('.btn', 'New factory run')
    await h.wait(400)
    await h.setValue('.factory-form select', 'House flow', `e.querySelector('option')?.textContent === 'House flow (project)'`)
    await h.wait(300)
  }

  await h.click('.activitybar button[title^="Factory"]')
  await h.wait(600)
  await open()
  await h.click('.stage-choices summary')
  await h.wait(500)
  h.expect(await h.js(`document.querySelector('select[aria-label="Skill for spec"]').value === 'house-spec'`), 'the spec stage shows the recipe skill')
  h.expect(await h.js(`[...document.querySelectorAll('select[aria-label="Skill for spec"] option')].some(o => o.textContent.startsWith('/house-spec (project)'))`), 'skills from .sldev/skills are offered')
  await h.setValue('select[aria-label="Agent for build"]', 'codex', `e.querySelector('option[value=codex]')`)
  await h.setValue('.factory-form textarea', 'Dark mode')
  await h.wait(200)
  await h.shot('1-stage-choices')
  await h.click('.factory-form .btn.primary', 'Start')

  h.expect(await h.until(async () => (await runs())[0]?.status === 'done', 40000), 'the run finishes')
  const first = argvs()
  const spec = first[0]?.[first[0].length - 1] ?? ''
  h.expect(spec.includes(path.join('.sldev', 'skills', 'house-spec', 'SKILL.md')) && spec.includes('Dark mode'), `the spec stage runs the skill with the intent (got ${JSON.stringify(spec.slice(0, 200))})`)
  const run1 = (await runs())[0]
  h.expect(run1.recipe.nodes[1].agents[0] === 'codex', 'the build stage ran on the agent picked for this run')
  await h.shot('2-run-done')

  // start from an existing spec: no spec stage, the file is the spec
  const before = argvs().length
  await open()
  await h.setValue('.factory-form select', 'spec', `e.querySelector('option[value=spec]')`)
  await h.wait(200)
  await h.setValue('input[aria-label="File in the repository"]', 'docs/spec.md')
  await h.setValue('.factory-form textarea', 'Dark mode from the spec')
  await h.wait(200)
  await h.shot('3-start-from-file')
  await h.click('.factory-form .btn.primary', 'Start')
  h.expect(await h.until(async () => (await runs())[0]?.intent === 'Dark mode from the spec' && (await runs())[0]?.status === 'done', 40000), 'the seeded run finishes')
  const run2 = (await runs())[0]
  h.expect(run2.nodes.spec.note === 'From docs/spec.md', 'the spec stage is marked as coming from the file')
  h.expect(fs.readFileSync(path.join(run2.outDir, 'spec.md'), 'utf8').includes('A toggle in settings.'), 'the file is the spec output')
  const after = argvs().slice(before)
  h.expect(after.length === 1 && after[0][after[0].length - 1].startsWith('Build what'), `only the build stage ran (${after.length} agent starts)`)
}

module.exports.env = { SLDEV_E2E_ARGV: log }
