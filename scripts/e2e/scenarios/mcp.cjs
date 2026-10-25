// sldev MCP server: a Claude step (fake CLI) starts the server from --mcp-config, reports that it
// needs you, then hands over its output through sldev_output.
const fs = require('fs')
const path = require('path')

const RECIPE = `name: E2E MCP
stages:
  - id: spec
    agent: claude
    prompt: USE_MCP Write a spec for {intent}.
`

module.exports = async (h) => {
  fs.mkdirSync(path.join(h.fixture, '.sldev', 'factory'), { recursive: true })
  fs.writeFileSync(path.join(h.fixture, '.sldev', 'factory', 'mcp.yml'), RECIPE)
  await h.openFixture()
  h.expect(fs.existsSync(path.join(h.userData, 'sldev-mcp.cjs')), 'the MCP server script is installed in userData')
  const endpoint = path.join(h.userData, 'mcp-endpoint.json')
  h.expect((fs.statSync(endpoint).mode & 0o777) === 0o600, 'its endpoint file (port and token) is private')
  await h.click('.activitybar button[title^="Factory"]')
  await h.wait(500)
  await h.click('.btn', 'New factory run')
  await h.wait(400)
  await h.setValue('.factory-form select', '0', `e.querySelector('option')?.textContent === 'E2E MCP (project)'`)
  await h.setValue('.factory-form textarea', 'Store orders')
  await h.click('.factory-form .btn.primary', 'Start')

  const mission = async () => (await h.js(`window.api.store.get('missions')`)).missions[0]
  h.expect(await h.until(async () => (await mission())?.status === 'needs-input', 15000), 'the agent reported "needs you" through sldev_status')
  h.expect((await mission()).notification === 'Which database should I use?', 'with its own message')
  const runs = () => h.js(`window.api.store.get('factoryRuns').then(s => s.runs)`)
  h.expect(await h.until(async () => (await runs())[0]?.status === 'done', 20000), 'the step finished')
  const run = (await runs())[0]
  h.expect(fs.readFileSync(path.join(run.outDir, 'spec.md'), 'utf8').startsWith('# Spec via MCP'), 'its output came through sldev_output')
  const m = await mission()
  h.expect(m.history.some((x) => x.status === 'needs-input') && m.history.some((x, i) => i > 0 && x.status === 'working' && m.history[i - 1].status === 'needs-input'), 'history shows needs you, then working again')
  await h.shot('0-done')
}
