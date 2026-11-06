// Recipes panel: the library, building a recipe step by step, editing, export/import as a file,
// run from a recipe, delete. Dialogs and the trash are stubbed here in main, nothing leaves the fixture.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { dialog, shell } = require('electron')

module.exports = async (h) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sldev-recipe-export-'))
  const exported = path.join(out, 'docs-refresh.sldev-recipe.yml')
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported })
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [exported] })
  const trashed = []
  shell.trashItem = async (p) => (trashed.push(p), fs.rmSync(p))
  const recipeFile = path.join(h.fixture, '.sldev', 'factory', 'docs-refresh.yml')

  await h.openFixture()
  await h.click('.activitybar button[title^="Factory"]')
  await h.wait(600)
  const listed = await h.js(`[...document.querySelectorAll('.side-recipe-name')].map(e => e.textContent)`)
  h.expect(listed.includes('Feature') && listed.includes('Bug fix'), `the Factory sidebar lists the recipes (${listed.join(', ')})`)
  await h.shot('1-sidebar')

  await h.click('.side-recipes-open')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.recipes .recipe-detail')`), 3000), 'Recipes opens on a recipe')
  h.expect(await h.js(`document.querySelectorAll('.recipe-detail .flow-node').length >= 4`), 'the detail shows the stages as a flow')
  await h.shot('2-library')

  // build one from a starter
  await h.click('.recipes-head-actions .btn', 'New recipe')
  await h.wait(300)
  h.expect(await h.js(`document.querySelector('.builder-foot .btn.primary').disabled`), 'Next waits for a name')
  await h.setValue('.builder-page input', 'Docs refresh', `e.placeholder.startsWith('Feature with')`)
  await h.setValue('.builder-page input', 'Rewrites the docs for a change', `e.placeholder.startsWith('What it does')`)
  await h.shot('3-basics')
  await h.click('.template-card', 'Plan → build → check → PR')
  await h.wait(300)
  const stages = await h.js(`[...document.querySelectorAll('.stage-list-id')].map(e => e.textContent)`)
  h.expect(stages.join() === 'plan,build,check,pr', `the starter fills in its stages (${stages.join()})`)
  h.expect(await h.js(`document.querySelector('.builder-page input, .stage-form input')?.value === 'plan'`), 'the first stage is open')

  // plan runs on Codex; add a review stage, which lands before the pull request
  await h.setValue('select[aria-label="Agent 1"]', 'codex')
  await h.click('.stage-add .btn', 'Agent')
  await h.wait(200)
  const after = await h.js(`[...document.querySelectorAll('.stage-list-id')].map(e => e.textContent)`)
  h.expect(after.join() === 'plan,build,check,review,pr', `a new stage goes before the pull request (${after.join()})`)
  h.expect(await h.js(`document.querySelector('.builder-status').textContent.includes('needs a prompt')`), 'the footer says what is missing')
  h.expect(await h.js(`document.querySelector('.stage-list-item.bad .stage-list-id')?.textContent === 'review'`), 'and marks the stage')
  await h.setValue('.stage-form textarea', 'Review the docs against ')
  await h.click('.stage-form .placeholder-chip', '{plan.out}')
  await h.wait(100)
  h.expect(await h.js(`document.querySelector('.stage-form textarea').value === 'Review the docs against {plan.out}'`), 'a placeholder chip inserts at the cursor')
  await h.click('.stage-form .check', 'Wait for my approval')
  await h.shot('4-stages')

  // a renamed stage keeps the stages that point at it
  await h.click('.stage-list-item', 'plan')
  await h.setValue('.stage-form input[aria-label="Stage name"]', 'outline')
  await h.click('.builder-step', 'Review')
  await h.wait(200)
  const yaml = await h.js(`(() => { const d = document.querySelector('.builder-more'); d.open = true; return document.querySelector('.recipe-yaml').textContent })()`)
  h.expect(yaml.includes('{outline.out}') && !yaml.includes('{plan.out}'), 'renaming a stage updates the placeholders that read it')
  h.expect(yaml.includes('onFail: { retry: build, max: 2 }'), 'the check sends failures back to build')
  await h.shot('5-review')
  await h.click('.builder-foot .btn.primary', 'Save recipe')
  h.expect(await h.until(() => fs.existsSync(recipeFile) && fs.readFileSync(recipeFile, 'utf8').includes('stages:'), 3000), 'saving writes .sldev/factory/docs-refresh.yml')
  const saved = fs.readFileSync(recipeFile, 'utf8')
  h.expect(saved.includes('name: Docs refresh') && saved.includes('agent: codex') && saved.includes('gate: approve'), 'the file has what was built')
  h.expect(await h.until(() => h.js(`document.querySelector('.recipe-detail h3')?.textContent === 'Docs refresh'`), 3000), 'the saved recipe is shown')
  h.expect(await h.js(`[...document.querySelectorAll('.side-recipe-name')].some(e => e.textContent === 'Docs refresh')`), 'and listed in the sidebar')

  // edit it again
  await h.click('.recipe-actions .btn', 'Edit')
  await h.wait(200)
  await h.setValue('.builder-page input', 'Rewrites the docs, then reviews them', `e.placeholder.startsWith('What it does')`)
  await h.click('.builder-step', 'Review')
  await h.click('.builder-foot .btn.primary', 'Save changes')
  h.expect(await h.until(() => fs.readFileSync(recipeFile, 'utf8').includes('then reviews them'), 3000), 'edits are saved over the same file')
  h.expect(fs.readdirSync(path.dirname(recipeFile)).length === 1, 'without a second file')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.recipe-detail')`), 2000), 'saving goes back to the recipe')

  // leaving unsaved changes asks first
  await h.click('.recipes-head-actions .btn', 'New recipe')
  await h.setValue('.builder-page input', 'Throwaway', `e.placeholder.startsWith('Feature with')`)
  await h.click('.builder-foot .btn', 'Cancel')

  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open] .modal-title')?.textContent === 'Discard your changes?'`), 2000), 'cancel with changes asks to discard')
  await h.click('dialog[open] .btn', 'Discard')
  await h.wait(300)
  h.expect(await h.until(() => h.js(`!!document.querySelector('.recipe-detail')`), 2000), 'discarding goes back to the recipe')

  // export to a file, then importing it finds it's already here
  await h.click('.recipe-item', 'Docs refresh')
  await h.wait(200)
  await h.click('.recipe-actions .btn', 'Export file')
  h.expect(await h.until(() => fs.existsSync(exported), 3000), 'export writes the file picked in the save dialog')
  h.expect(fs.readFileSync(exported, 'utf8').startsWith('# sldev-io recipe "Docs refresh"'), 'as a shareable bundle')
  await h.click('dialog[open] .btn', 'OK')
  await h.click('.recipes-head-actions .btn', 'Import')
  await h.wait(300)
  await h.click('.import-sources .btn', 'From a file')
  h.expect(await h.until(() => h.js(`document.querySelector('.import-preview')?.textContent.includes('already has this exact recipe')`), 3000), 'importing the file previews it')
  await h.shot('6-import-file')
  await h.click('dialog[open] .btn.ghost', 'Cancel')

  // run it: the run form opens with the recipe picked
  await h.click('.recipe-detail-head .btn.primary', 'Run')
  h.expect(await h.until(() => h.js(`document.querySelector('.factory-form select')?.value === 'Docs refresh'`), 3000), 'Run opens the run form with this recipe')
  h.expect(await h.js(`document.activeElement === document.querySelector('.factory-form textarea')`), 'and the cursor in what to build')
  h.expect(await h.js(`!document.querySelector('.factory-form .stage-choices').open`), 'per-stage options start folded away')
  await h.wait(400)
  await h.shot('7-run-form')
  await h.click('.factory-form .btn', 'Cancel')
  h.expect(await h.until(() => h.js(`!document.querySelector('dialog[open]')`), 2000), 'the run form closes')

  // delete goes to the trash, after asking
  await h.click('.recipe-actions .btn', 'Delete')
  await h.wait(300)
  await h.shot('8-delete')
  h.expect(await h.until(() => h.js(`document.querySelector('dialog[open] .modal-title')?.textContent.startsWith('Delete "Docs refresh"')`), 2000), 'delete asks first')
  await h.click('dialog[open] .btn', 'Delete recipe')
  h.expect(await h.until(() => !fs.existsSync(recipeFile), 3000), 'the file is gone')
  h.expect(trashed.length === 1 && trashed[0] === recipeFile, 'moved to the trash, not unlinked')
  h.expect(await h.until(() => h.js(`![...document.querySelectorAll('.recipe-item-name')].some(e => e.textContent === 'Docs refresh')`), 2000), 'and no longer listed')

  fs.rmSync(out, { recursive: true, force: true })
}
