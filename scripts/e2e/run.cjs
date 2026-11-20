// End-to-end harness: boots the built app (out/) against a throwaway git repo and a temp userData,
// with fake agent CLIs (scripts/e2e/fakebin) first on PATH, then runs a scenario that drives the UI.
//
//   npm run e2e -- missions            # scripts/e2e/scenarios/missions.cjs
//
// Screenshots + console.log land in .e2e-out/<scenario>/. Exit code 1 if any h.expect() failed.
const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const name = process.argv.find((a) => !a.startsWith('-') && !a.endsWith('.cjs') && !a.includes('electron')) ?? 'smoke'
const repoRoot = path.resolve(__dirname, '../..')
const out = path.join(repoRoot, '.e2e-out', name)
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sldev-io-e2e-'))
app.setPath('userData', path.join(tmp, 'userdata'))
// a scenario can set env before the app starts: module.exports.env = { SLDEV_E2E_VERSION: '1.0.0' }
const scenario = require(path.join(__dirname, 'scenarios', `${name}.cjs`))
Object.assign(process.env, scenario.env ?? {})
// run as the real app version unless the scenario wants another
app.setVersion(process.env.SLDEV_E2E_VERSION || require(path.join(repoRoot, 'package.json')).version)

// skip the first-run setup panel and What's new unless a scenario turns them back on
// (openFixture({ setupSeen: false }), openFixture({ lastSeenVersion: '…' }))
fs.mkdirSync(path.join(tmp, 'userdata'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'userdata', 'settings.json'), JSON.stringify({ setupSeen: true, lastSeenVersion: app.getVersion() }))

// fixture project: a git repo with a package.json so runtimes, missions and diffs have something to work on
const fixture = path.join(tmp, 'project')
fs.mkdirSync(path.join(fixture, 'src'), { recursive: true })
fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { dev: 'node -e "console.log(\'listening on http://localhost:5173\')"', test: 'echo ok' } }, null, 2))
fs.writeFileSync(path.join(fixture, 'src/app.js'), "console.log('hello')\n")
const git = (...args) => execFileSync('git', args, { cwd: fixture, stdio: 'ignore' })
git('init', '-q', '-b', 'main')
git('-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', 'add', '.')
git('-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', 'commit', '-qm', 'init')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// fakes that only record what they were asked (fakebin/code) write next to the fixture
process.env.SLDEV_E2E_TMP = tmp
// always the built renderer: a harness started from a terminal inside `npm run dev` inherits the dev server's
// URL, and would otherwise test whatever that server serves instead of out/
delete process.env.ELECTRON_RENDERER_URL
require(path.join(repoRoot, 'out/main/index.js'))

app.whenReady().then(async () => {
  // the app merges the login-shell env a few seconds after start; put fakes on PATH after that
  await wait(4000)
  process.env.PATH = path.join(__dirname, 'fakebin') + path.delimiter + process.env.PATH
  const win = BrowserWindow.getAllWindows()[0]
  const wc = win.webContents
  // a window covered by others on the desktop stops painting: screenshots go stale and rAF-driven layout waits
  wc.setBackgroundThrottling(false)
  const logs = []
  const failures = []
  wc.on('console-message', (e) => e.level !== 'debug' && logs.push(`[${e.level}] ${e.message}`))
  const js = (code) => wc.executeJavaScript(code)
  const h = {
    out,
    fixture,
    userData: path.join(tmp, 'userdata'),
    wait,
    js,
    log: (...a) => logs.push(a.join(' ')),
    expect: (cond, msg) => {
      logs.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`)
      if (!cond) failures.push(msg)
    },
    /** poll fn() until it returns truthy or timeoutMs passes; resolves to the last value */
    until: async (fn, timeoutMs = 8000, everyMs = 200) => {
      const end = Date.now() + timeoutMs
      let v
      while (!(v = await fn()) && Date.now() < end) await wait(everyMs)
      return v
    },
    shot: async (file) => fs.writeFileSync(path.join(out, `${file}.png`), (await win.capturePage()).toPNG()),
    key: (keyCode, modifiers = []) => {
      for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode, modifiers })
    },
    /** a raw mouse event (mouseDown/mouseMove/mouseUp) at window coordinates */
    mouse: (event) => wc.sendInputEvent(event),
    type: (text) => {
      for (const ch of text) wc.sendInputEvent({ type: 'char', keyCode: ch })
    },
    /** click the first element matching selector (and containing text, if given) */
    click: (selector, text) =>
      js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!el) return false; el.click(); return true })()`),
    /** set a React-controlled input/textarea/select; `selector` may match several, `pick` filters them */
    setValue: (selector, value, pick = 'true') =>
      js(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => ${pick});
        if (!el) return false;
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
        return true })()`),
    reload: async () => {
      wc.reload()
      await wait(3000)
    },
    /** open the fixture project with notifications off, then reload */
    openFixture: async (extra = {}) => {
      // SLDEV_E2E_THEME=light runs any scenario in the light theme (a scenario's own `theme` wins)
      const theme = process.env.SLDEV_E2E_THEME ? { theme: process.env.SLDEV_E2E_THEME } : {}
      await js(`window.api.settings.set(${JSON.stringify({ rootFolder: fixture, notifications: false, sidebarVisible: true, ...theme, ...extra })})`)
      wc.reload()
      await wait(3000)
    }
  }
  try {
    await scenario(h)
  } catch (e) {
    failures.push(String(e))
    logs.push('ERROR ' + e.stack)
  }
  fs.writeFileSync(path.join(out, 'console.log'), logs.join('\n') + '\n')
  console.log(logs.filter((l) => /^(PASS|FAIL|ERROR)/.test(l)).join('\n'))
  console.log(failures.length ? `\n${failures.length} failed. See ${out}` : `\nall passed. Screenshots in ${out}`)
  fs.rmSync(tmp, { recursive: true, force: true })
  app.exit(failures.length ? 1 : 0)
})
