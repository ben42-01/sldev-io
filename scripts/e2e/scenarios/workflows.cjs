// GitHub Workflows: two sections that scroll on their own, and dispatching a workflow with typed inputs.
const fs = require('fs')
const path = require('path')

module.exports = async (h) => {
  const wf = path.join(h.fixture, '.github', 'workflows')
  fs.mkdirSync(wf, { recursive: true })
  fs.writeFileSync(
    path.join(wf, 'deploy.yml'),
    'on:\n  workflow_dispatch:\n    inputs:\n      environment:\n        description: Environment\n        type: choice\n        required: true\n        options: [staging, production]\n      migrate:\n        description: Run database migrations\n        type: boolean\n'
  )
  await h.openFixture({ rightPanelVisible: true, rightPanelTab: 'workflows', rightPanelWidth: 340 })
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.wf-section.list .wf-row').length === 26`), 8000), 'workflows section lists every workflow')
  h.expect(await h.until(() => h.js(`document.querySelectorAll('.wf-section.runs .run-row').length === 30`), 8000), 'runs section lists the runs')
  const scrolls = await h.js(`[...document.querySelectorAll('.wf-section-body')].map(b => b.scrollHeight > b.clientHeight)`)
  h.expect(scrolls[0] && scrolls[1], 'both sections scroll on their own')
  h.expect(await h.js(`document.querySelector('.wf-section.runs').getBoundingClientRect().top < window.innerHeight / 2 + 100`), 'runs stay in view below a long workflow list')
  await h.shot('0-sections')

  await h.click('.wf-section.list .wf-section-header')
  await h.wait(200)
  h.expect(await h.js(`!document.querySelector('.wf-section.list .wf-section-body')`), 'a section collapses')
  h.expect(await h.js(`window.api.settings.get().then(s => s.assetGroups['workflows:list'] === false)`), 'collapsed sections are remembered')
  await h.shot('1-collapsed')
  await h.click('.wf-section.list .wf-section-header')
  await h.wait(200)

  await h.js(`(() => { const row = [...document.querySelectorAll('.wf-row')].find(r => r.textContent.includes('Deploy')); row.querySelector('button').click() })()`)
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.inline-form option')].some(o => o.value === 'production')`), 4000), 'dispatch form shows the choice input')
  h.expect(await h.js(`[...document.querySelectorAll('.inline-form .check span')].some(s => s.textContent.includes('Run database migrations'))`), 'dispatch form shows the boolean input')
  await h.shot('2-dispatch')
  await h.click('.inline-form button[type="submit"]')
  h.expect(await h.until(() => fs.existsSync(path.join(h.fixture, 'gh-dispatch-marker.txt')), 4000), 'Run workflow dispatches it')
  const sent = fs.readFileSync(path.join(h.fixture, 'gh-dispatch-marker.txt'), 'utf8')
  h.expect(/workflow run 1 --ref \S+ -f environment=staging -f migrate=false/.test(sent), 'dispatch passes the branch and inputs')
}

module.exports.env = { FAKE_GH_AUTHED: '1' }
