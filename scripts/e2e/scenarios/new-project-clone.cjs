// New project → Clone: from the palette while gh is logged out (the list says so, a pasted path still clones), then from
// the title bar menu signed in: the list of repos filters as you type, an existing non-empty folder is refused, a slow
// clone shows progress and is cancelled (the partial folder goes), and the next clone opens as the project.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

module.exports = async (h) => {
  const tmp = path.dirname(h.fixture)
  const clones = path.join(tmp, 'clones')
  fs.mkdirSync(clones)
  // the "remote": a bare copy of the fixture
  const bare = path.join(tmp, 'remote', 'shop.git')
  execFileSync('git', ['clone', '-q', '--bare', h.fixture, bare], { stdio: 'ignore' })
  // a git that stays in "Receiving objects" with a partial folder while slow.txt exists (so Cancel has something to stop)
  const wrap = path.join(tmp, 'gitwrap')
  const slow = path.join(tmp, 'slow.txt')
  fs.mkdirSync(wrap)
  const realGit = execFileSync('sh', ['-c', 'command -v git']).toString().trim()
  fs.writeFileSync(
    path.join(wrap, 'git'),
    `#!/bin/sh\nif [ "$1" = clone ] && [ -f ${JSON.stringify(slow)} ]; then\n  for a; do d="$a"; done\n  mkdir -p "$d" && echo partial > "$d/partial.txt"\n  echo "Cloning into '$(basename "$d")'..." >&2\n  printf 'Receiving objects:  42%% (21/50)\\r' >&2\n  exec sleep 60\nfi\nexec ${JSON.stringify(realGit)} "$@"\n`,
    { mode: 0o755 }
  )
  process.env.PATH = wrap + path.delimiter + process.env.PATH

  await h.openFixture()
  const palette = async (q) => {
    await h.js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true }))`)
    await h.wait(300)
    h.type(q)
    await h.wait(300)
    h.key('Return')
  }
  const open = () => h.until(() => h.js(`!!document.querySelector('.np-repos')`), 4000)
  const hint = () => h.js(`document.querySelector('.np-name .field-hint')?.textContent ?? ''`)
  const cloneBtn = () => h.js(`(() => { const b = document.querySelector('.modal-footer .btn.primary'); return b ? { disabled: b.disabled, text: b.textContent } : null })()`)

  // 1. logged out: the list says why, and a pasted path still clones with git
  await palette('new project')
  h.expect(await open(), 'New project… opens the dialog from the palette')
  h.expect(await h.until(() => h.js(`document.querySelector('.np-repos .empty-title')?.textContent.includes('can’t be listed')`), 5000), 'logged out, the list says the repos can’t be listed')
  h.expect(await h.js(`document.querySelector('.np-repos .empty-hint')?.textContent.includes('gh auth login')`), 'and how to sign in')
  h.expect(await h.js(`[...document.querySelectorAll('.np-choice')].some(b => b.textContent.includes('Start from scratch') && !b.disabled)`), 'Start from scratch is there to pick')
  await h.wait(500)
  await h.shot('0-logged-out')
  await h.setValue('.np-search', bare)
  await h.setValue('.np-parent input', clones)
  h.expect(await h.until(() => h.js(`!!document.querySelector('.np-pasted')`), 2000), 'a pasted path shows as the source')
  h.expect(await h.until(async () => (await h.js(`document.querySelector('.np-name input').value`)) === 'shop', 2000), 'the folder name defaults to the repo name')
  h.expect(await h.until(async () => (await hint()).includes(path.join(clones, 'shop')), 2000), `the hint says where it clones (${await hint()})`)
  await h.wait(300)
  await h.shot('1-pasted')
  await h.click('.modal-footer .btn.primary', 'Clone')
  h.expect(await h.until(() => h.js(`!document.querySelector('.np-repos')`), 10000), 'the dialog closes when the clone is done')
  const first = path.join(clones, 'shop')
  h.expect(fs.existsSync(path.join(first, 'src', 'app.js')), 'the repo is cloned')
  h.expect(await h.until(async () => (await h.js(`window.api.settings.get()`)).rootFolder === first, 3000), 'and opens as the project')
  h.expect((await h.js(`window.api.settings.get()`)).cloneParent === clones, 'the parent folder is remembered')

  // 2. signed in, from the title bar menu
  process.env.FAKE_GH_AUTHED = '1'
  process.env.FAKE_GH_REPO_URL = bare
  await h.click('.titlebar-project')
  await h.wait(300)
  h.expect(await h.click('.ctx-item', 'New project…'), 'the title bar menu has New project…')
  h.expect(await open(), 'and it opens the dialog')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.np-repo:not(.np-pasted)').length === 3`), 5000), 'the list shows the user’s three repos')
  h.expect(await h.js(`document.querySelector('.np-parent input').value`) === clones, 'the parent folder is the one used last')
  h.expect(await h.js(`document.querySelector('.np-repo b')?.textContent === 'acme/shop'`), 'newest first')
  await h.setValue('.np-search', 'guides')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.np-repo b')].map(b => b.textContent).join() === 'acme/docs'`), 2000), 'typing filters by name and description')
  await h.wait(300)
  await h.shot('2-filtered')
  await h.setValue('.np-search', 'nothing-like-this')
  h.expect(await h.until(() => h.js(`document.querySelector('.np-repos .empty-title')?.textContent.includes('No repository matches')`), 2000), 'no match says so')
  await h.setValue('.np-search', 'shop')
  await h.wait(200)
  await h.click('.np-repo', 'acme/shop')

  // the folder from step 1 is there and not empty: refused before anything runs
  h.expect(await h.until(async () => (await hint()).includes('isn’t empty'), 2000), `an existing non-empty folder is refused (${await hint()})`)
  h.expect((await cloneBtn())?.disabled, 'and Clone is disabled')
  await h.wait(300)
  await h.shot('3-refused')

  // a slow clone: progress, then Cancel removes the partial folder
  await h.setValue('.np-name input', 'shop-2')
  h.expect(await h.until(async () => (await cloneBtn())?.disabled === false, 2000), 'a new folder name can be cloned')
  fs.writeFileSync(slow, '')
  await h.click('.modal-footer .btn.primary', 'Clone')
  const second = path.join(clones, 'shop-2')
  h.expect(await h.until(() => h.js(`document.querySelector('.np-progress')?.textContent.includes('Receiving objects') && document.querySelector('.np-progress')?.textContent.includes('42%')`), 5000), 'progress shows git’s phase and percent')
  h.expect(fs.existsSync(path.join(second, 'partial.txt')), 'git has started a folder')
  h.expect(await h.js(`document.querySelector('.modal-header .icon-btn').disabled`), 'the dialog can’t be closed mid-clone')
  await h.wait(400)
  await h.shot('4-progress')
  await h.click('.modal-footer .btn', 'Cancel clone')
  h.expect(await h.until(() => h.js(`!document.querySelector('.np-progress')`), 5000), 'Cancel stops the clone')
  h.expect(!fs.existsSync(second), 'and the partial folder is removed')
  h.expect(await h.js(`!!document.querySelector('.np-repos')`), 'the dialog stays open to try again')
  fs.rmSync(slow)

  await h.click('.modal-footer .btn.primary', 'Clone')
  h.expect(await h.until(() => h.js(`!document.querySelector('.np-repos')`), 10000), 'the second clone finishes')
  h.expect(fs.existsSync(path.join(second, 'src', 'app.js')), 'acme/shop is cloned from its URL')
  h.expect(await h.until(async () => (await h.js(`window.api.settings.get()`)).rootFolder === second, 3000), 'and opens as the project')
  await h.wait(800)
  await h.shot('5-opened')
}
