// A pull request with a 20k-line diff opens and gets a walkthrough without the window or main freezing (no line in
// stalls.log, no long task over a second in the window). Then a handler that blocks main on purpose leaves a stall
// line with the IPC calls just before it (channel, duration), also in About's diagnostics, and nothing else.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { ipcMain, app } = require('electron')

module.exports = async (h) => {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'e2e', GIT_AUTHOR_EMAIL: 'e2e@example.com', GIT_COMMITTER_NAME: 'e2e', GIT_COMMITTER_EMAIL: 'e2e@example.com' }
  const g = (cwd, ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' }).trim()
  const tmp = path.dirname(h.fixture)
  const origin = path.join(tmp, 'origin.git')
  const fork = path.join(tmp, 'fork')
  g(tmp, 'init', '-q', '--bare', '-b', 'main', origin)
  g(h.fixture, 'remote', 'add', 'origin', origin)
  g(h.fixture, 'push', '-q', '-u', 'origin', 'main')
  g(tmp, 'clone', '-q', origin, fork)
  // 50 new files of 400 lines: 20k added lines, each an export (the unused-code check reads every one)
  for (let f = 0; f < 50; f++) {
    fs.mkdirSync(path.join(fork, 'src', `m${f}`), { recursive: true })
    const lines = Array.from({ length: 400 }, (_, i) => (i % 2 ? `export function make${f}_${i}(x) { return make${f}_${i - 1}(x) + ${i} }` : `export const value${f}_${i} = ${i}`))
    fs.writeFileSync(path.join(fork, 'src', `m${f}`, 'gen.js'), lines.join('\n') + '\n')
  }
  g(fork, 'add', '-A')
  g(fork, 'commit', '-q', '-m', 'big')
  const sha = g(fork, 'rev-parse', 'HEAD')
  g(fork, 'push', '-q', '--force', origin, `${sha}:refs/pull/128/head`)
  process.env.FAKE_GH_PR_128_HEAD = sha
  const stalls = path.join(app.getPath('userData'), 'stalls.log')
  const log = () => (fs.existsSync(stalls) ? fs.readFileSync(stalls, 'utf8') : '')

  await h.openFixture({ rightPanelVisible: true, rightPanelTab: 'workflows', rightPanelWidth: 360, reviewFocus: false })
  await h.js(`window.__longest = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longest = Math.max(window.__longest, e.duration) }).observe({ type: 'longtask', buffered: true })`)
  await h.click('.wf-section.prs .wf-section-header')
  await h.until(() => h.js(`!!document.querySelector('.pr-row[data-pr="128"]')`), 8000)
  const t0 = Date.now()
  await h.click('.pr-row[data-pr="128"]')
  h.expect(await h.until(() => h.js(`!!document.querySelector('.rc .rc-part')`), 20000), 'the 20k-line PR opens in the cockpit')
  console.log(`opened in ${Date.now() - t0} ms`)
  await h.click('.rc-explain .btn.primary', 'Explain the change')
  h.expect(await h.until(() => h.js(`[...document.querySelectorAll('.rc-part-item:not(.noise) .rc-part-title')].some(t => t.textContent === 'The asked change')`), 30000), 'and gets its walkthrough')
  await h.wait(1500)
  const longest = await h.js('window.__longest')
  console.log(`longest task in the window: ${Math.round(longest)} ms`)
  h.expect(longest < 1000, `no task in the window over a second (${Math.round(longest)} ms)`)
  h.expect(!/window unresponsive|main process blocked/.test(log()), `nothing in stalls.log (${log().trim()})`)
  await h.shot('1-big-walkthrough')

  // a handler that blocks main for 2 s: the stall line says what ran just before it
  ipcMain.removeHandler('clipboard:read')
  ipcMain.handle('clipboard:read', () => {
    const end = Date.now() + 2000
    while (Date.now() < end);
    return 'x'.repeat(200 * 1024)
  })
  await h.js(`window.api.git.branch(${JSON.stringify(h.fixture)}).then(() => window.api.clipboard.readText())`)
  h.expect(await h.until(() => /main process blocked/.test(log()), 5000), 'the block is noted in stalls.log')
  const lines = log().trim().split('\n')
  const at = lines.findIndex((l) => l.includes('main process blocked'))
  const trail = lines.slice(at + 1).filter((l) => l.startsWith('  '))
  console.log(lines.slice(at).join('\n'))
  h.expect(trail.some((l) => / clipboard:read 200 KB 2\.\d s$/.test(l)) && trail.some((l) => / git:branch \d+ ms$/.test(l)), `followed by the calls before it, with durations and sizes (${trail})`)
  h.expect(!log().includes(h.fixture) && !log().includes('xxxx'), 'with no arguments, paths or output')
  const info = await h.js('window.api.app.info()')
  h.expect(info.stalls.some((l) => l.includes('clipboard:read')), 'and About diagnostics shows them')
  ipcMain.removeHandler('clipboard:read')
  ipcMain.handle('clipboard:read', () => require('electron').clipboard.readText())
  delete process.env.FAKE_GH_PR_128_HEAD
}

module.exports.env = { FAKE_GH_AUTHED: '1', FAKE_GH_PR_DIFF_REAL: '1' }
