// Project context: learnings, .sldev/context docs, pinned files and skills are indexed locally; Skills →
// Context lists and searches them, a mission's prompt gets the notes matching its brief, sldev_recall
// answers by file, and the Map kind starts without a brief.
const fs = require('fs')
const http = require('http')
const path = require('path')

const d = new Date()
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
// today: newer than src/routes.js, written below; the 2020 note is older than the fixture's commit of src/app.js
const MEMORY = `# Project memory

- ${today}: The router reads routes from src/routes.js, not from app.js (codex, mission "Routing") · files: src/routes.js
- 2020-01-01: Logging goes through console in src/app.js (you)
`
const ARCH = `# Architecture

## Routing
Requests enter in \`src/app.js\` and are matched against the table in \`src/routes.js\`.

## Release
Bump package.json and tag.
`

function mcp(userData, mission, tool, args) {
  const { port, token } = JSON.parse(fs.readFileSync(path.join(userData, 'mcp-endpoint.json'), 'utf8'))
  const body = JSON.stringify({ mission, tool, args, cwd: '' })
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'content-type': 'application/json', 'x-sldev-token': token } }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve(JSON.parse(d)))
    })
    req.on('error', reject)
    req.end(body)
  })
}

module.exports = async (h) => {
  const f = (rel) => path.join(h.fixture, rel)
  fs.mkdirSync(f('.sldev/context'), { recursive: true })
  fs.writeFileSync(f('src/routes.js'), "module.exports = { '/': 'home' }\n")
  fs.writeFileSync(f('.sldev/memory.md'), MEMORY)
  fs.writeFileSync(f('.sldev/context/architecture.md'), ARCH)
  await h.openFixture({ rightPanelVisible: true })

  await h.click('.right-tab[aria-label^="Project Context"]')
  h.expect(await h.until(async () => (await h.js(`document.querySelectorAll('.context-row').length`)) >= 4, 5000), 'Context lists the learnings and doc sections')
  const staleCount = await h.js(`document.querySelector('[data-group="learning"] .context-stale-count')?.textContent`)
  h.expect(staleCount === '1 to check', 'the 2020 learning about src/app.js is flagged: the file was committed after it')
  await h.shot('1-context')

  await h.setValue('input[aria-label="Search the project context"]', 'how does routing work')
  h.expect(await h.until(async () => (await h.js(`document.querySelectorAll('.context-results .context-row').length`)) >= 2, 4000), 'search shows the matching notes')
  const first = await h.js(`[...document.querySelectorAll('.context-results .context-title')].map(e => e.textContent).slice(0, 2).join(' | ')`)
  h.expect(/router reads routes/.test(first) && /Routing/.test(first), `the routing learning and doc section come first (${first})`)
  await h.shot('2-search')

  // pin through the API the explorer menu uses; the list picks it up when the window regains focus
  await h.js(`window.api.context.pin(${JSON.stringify(h.fixture)}, 'package.json', 'scripts and versions')`)
  await h.setValue('input[aria-label="Search the project context"]', '')
  await h.js(`window.dispatchEvent(new Event('focus'))`)
  h.expect(await h.until(async () => !!(await h.js(`document.querySelector('[data-group="file"] .context-title')?.textContent`)), 4000), 'a pinned file shows under Pinned files')
  h.expect(fs.readFileSync(f('.sldev/pinned.md'), 'utf8').includes('- `package.json`: scripts and versions'), 'and is written to .sldev/pinned.md')

  await h.click('.right-tab[aria-label^="Agent Missions"]')
  await h.wait(300)
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.click('.kind-picker button', 'Build')
  await h.setValue('.form textarea', 'Add a /health route to the router')
  await h.wait(900)
  await h.click('.prompt-preview summary')
  await h.wait(200)
  const p = await h.js(`document.querySelector('.prompt-preview pre').textContent`)
  h.expect(p.includes('Project context that looks relevant to this task'), 'the prompt lists the notes matching the brief')
  h.expect(p.includes(`${f('.sldev/memory.md')}:3: The router reads routes from src/routes.js`), 'with an absolute path and line, so a worktree can read it')
  h.expect(p.includes(`${f('.sldev/context/architecture.md')}:3: Routing`), 'including the matching doc section')
  h.expect(p.includes('sldev_recall'), 'and Claude is told it can look up more')
  await h.shot('3-preview')

  await h.click('.form .btn.primary', 'Launch')
  const mission = async () => (await h.js(`window.api.store.get('missions')`)).missions[0]
  h.expect(await h.until(async () => !!(await mission()), 5000), 'the mission starts')
  const m = await mission()
  h.expect(m.prompt.includes('Project context that looks relevant'), 'and the prompt it got is the one previewed')
  const recall = await mcp(h.userData, m.id, 'sldev_recall', { path: 'src/routes.js' })
  h.expect(recall.text.includes('The router reads routes') && recall.text.includes('Related files') && recall.text.includes('src/app.js'), 'sldev_recall by file returns its notes and the files they link to')
  await mcp(h.userData, m.id, 'sldev_remember', { note: 'Routes are hot-reloaded in dev', paths: ['src/routes.js'] })
  h.expect(/Routes are hot-reloaded in dev \(claude, mission "[^"]+"\) · files: src\/routes\.js\n$/.test(fs.readFileSync(f('.sldev/memory.md'), 'utf8')), 'sldev_remember records the files it is about')

  h.key('Escape')
  await h.wait(300)
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.click('.kind-picker button', 'Map project')
  await h.setValue('.form textarea', '')
  await h.wait(500)
  h.expect(!(await h.js(`document.querySelector('.form .btn.primary').disabled`)), 'a Map mission can launch without a brief')
  await h.click('.prompt-preview summary')
  await h.wait(200)
  const mp = await h.js(`document.querySelector('.prompt-preview pre').textContent`)
  h.expect(mp.startsWith('Mission: Map this project') && mp.includes('.sldev/context/'), 'its prompt asks for the docs in .sldev/context')
  await h.shot('4-map')
}
