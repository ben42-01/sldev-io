// Sharing a recipe: Share copies the recipe and its custom agent; Import in another project adds
// both (and keeps an agent you already have).
const fs = require('fs')
const path = require('path')
const { clipboard } = require('electron')

const RECIPE = `name: Secure feature
description: Build, then a security review.
stages:
  - id: build
    agent: codex
    prompt: Build {intent}
  - id: review
    agent: Security reviewer@claude
    prompt: Review the diff
`
const PROFILE = `---
name: Security reviewer
description: Finds holes
agent: claude
---

You review diffs for security issues. Never edit files.
`

module.exports = async (h) => {
  const sldev = path.join(h.fixture, '.sldev')
  fs.mkdirSync(path.join(sldev, 'factory'), { recursive: true })
  fs.mkdirSync(path.join(sldev, 'agents'), { recursive: true })
  fs.writeFileSync(path.join(sldev, 'factory', 'secure.yml'), RECIPE)
  fs.writeFileSync(path.join(sldev, 'agents', 'security-reviewer.md'), PROFILE)
  await h.openFixture()

  await h.click('.activitybar button[title^="Factory"]')
  await h.wait(600)
  await h.click('.btn', 'New factory run')
  await h.wait(400)
  await h.setValue('.factory-form select', '0', `e.querySelector('option')?.textContent === 'Secure feature (project)'`)
  await h.wait(200)
  await h.click('.factory-form .recipe-links .link', 'Share')
  await h.wait(300)
  const bundle = await clipboard.readText()
  h.expect(bundle.startsWith('# sldev-io recipe "Secure feature"') && bundle.includes('Never edit files.') && bundle.includes('Build {intent}'), 'Share copies the recipe with its agent')
  await h.shot('1-share')
  await h.click('.factory-form .btn', 'Cancel')

  // "another project": the recipe and the agent are gone
  fs.rmSync(sldev, { recursive: true, force: true })
  await h.reload()
  await h.click('.activitybar button[title^="Factory"]')
  await h.wait(600)
  await h.click('.btn', 'Import recipe')
  await h.wait(300)
  await h.setValue('.import-form textarea', bundle)
  await h.click('.import-form .btn.primary', 'Import')
  h.expect(await h.until(() => h.js(`document.querySelector('.import-form .ok')?.textContent ?? ''`), 5000), 'import reports what it added')
  const msg = await h.js(`document.querySelector('.import-form .ok').textContent`)
  h.log('import:', msg)
  h.expect(msg.includes('Added "Secure feature"') && msg.includes('New agents: Security reviewer'), 'adds the recipe and the agent')
  h.expect(fs.readFileSync(path.join(sldev, 'factory', 'secure-feature.yml'), 'utf8') === RECIPE, 'the recipe file is written as it was shared')
  h.expect(fs.readFileSync(path.join(sldev, 'agents', 'security-reviewer.md'), 'utf8').includes('Never edit files.'), 'the agent profile is written to .sldev/agents')
  await h.shot('2-imported')

  // importing again keeps your agent, and the recipe is offered for a run
  await h.setValue('.import-form textarea', bundle)
  await h.click('.import-form .btn.primary', 'Import')
  await h.wait(800)
  h.expect((await h.js(`document.querySelector('.import-form .ok').textContent`)).includes('Kept your own Security reviewer'), 'an agent you already have is kept')
  await h.click('.import-form .btn', 'Done')
  await h.click('.btn', 'New factory run')
  await h.wait(400)
  const opts = await h.js(`[...document.querySelectorAll('.factory-form select option')].map(o => o.textContent)`)
  h.expect(opts.includes('Secure feature (project)'), 'the imported recipe can be run')

  await h.click('.factory-form .btn', 'Cancel')
  await h.click('.btn', 'Import recipe')
  await h.setValue('.import-form textarea', 'name: [')
  await h.click('.import-form .btn.primary', 'Import')
  await h.wait(400)
  h.expect((await h.js(`document.querySelector('.import-form .bad')?.textContent ?? ''`)).includes('Not valid YAML'), 'a broken paste says why')
}
