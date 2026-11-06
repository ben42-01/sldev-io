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
  await h.setValue('.factory-form select', 'Secure feature', `e.querySelector('option')?.textContent === 'Secure feature (project)'`)
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
  const importDialog = async (text) => {
    await h.click('.side-head button[aria-label="Import a recipe"]')
    await h.wait(300)
    await h.setValue('.import-form textarea', text)
    await h.wait(200)
  }
  await importDialog(bundle)
  h.expect(await h.js(`document.querySelector('.import-preview')?.textContent.includes('Adds agents to .sldev/agents: Security reviewer')`), 'the preview says what will be added before anything is written')
  await h.shot('2a-import-preview')
  await h.click('dialog[open] .btn.primary', 'Import')
  h.expect(await h.until(() => h.js(`document.querySelector('.import-ok')?.textContent ?? ''`), 5000), 'import reports what it added')
  const msg = await h.js(`document.querySelector('.import-ok').textContent`)
  h.log('import:', msg)
  h.expect(msg.includes('Added "Secure feature"') && msg.includes('New agents: Security reviewer'), 'adds the recipe and the agent')
  h.expect(fs.readFileSync(path.join(sldev, 'factory', 'secure-feature.yml'), 'utf8') === RECIPE, 'the recipe file is written as it was shared')
  h.expect(fs.readFileSync(path.join(sldev, 'agents', 'security-reviewer.md'), 'utf8').includes('Never edit files.'), 'the agent profile is written to .sldev/agents')
  await h.shot('2-imported')
  await h.click('dialog[open] .btn.ghost', 'Close')
  await h.wait(300)

  // importing the same again adds nothing twice and keeps your agent
  await importDialog(bundle)
  h.expect(await h.js(`document.querySelector('.import-preview')?.textContent.includes('already has this exact recipe')`), 'the preview spots a recipe you already have')
  await h.click('dialog[open] .btn.primary', 'Import agents only')
  h.expect(await h.until(() => h.js(`document.querySelector('.import-ok')?.textContent ?? ''`), 5000), 'second import reports')
  const again = await h.js(`document.querySelector('.import-ok').textContent`)
  h.expect(again.includes('You already have "Secure feature"') && again.includes('Kept your own Security reviewer'), 'an agent you already have is kept, the recipe is not duplicated')
  h.expect(fs.readdirSync(path.join(sldev, 'factory')).length === 1, 'still one recipe file')
  await h.click('dialog[open] .btn.ghost', 'Close')

  // the same name with other stages is saved under a new name
  await importDialog(RECIPE.replace('Review the diff', 'Review it twice'))
  h.expect(await h.js(`document.querySelector('.import-preview')?.textContent.includes('saved as "Secure feature 2"')`), 'a taken name gets a number')
  await h.click('dialog[open] .btn.ghost', 'Cancel')

  await h.click('.btn', 'New factory run')
  await h.wait(400)
  const opts = await h.js(`[...document.querySelectorAll('.factory-form select option')].map(o => o.textContent)`)
  h.expect(opts.includes('Secure feature (project)'), 'the imported recipe can be run')
  await h.click('.factory-form .btn', 'Cancel')

  await importDialog('name: [')
  h.expect((await h.js(`document.querySelector('.import-form .bad')?.textContent ?? ''`)).includes('Not valid YAML'), 'a broken paste says why')
  h.expect(await h.js(`document.querySelector('dialog[open] .btn.primary').disabled`), 'and cannot be imported')
}
