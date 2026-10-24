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

// fixture project: a git repo with a package.json so runtimes, missions and diffs have something to work on
const fixture = path.join(tmp, 'project')
fs.mkdirSync(path.join(fixture, 'src'), { recursive: true })
fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { dev: 'node -e "console.log(\'listening on http://localhost:5173\')"', test: 'echo ok' } }, null, 2))
fs.writeFileSync(path.join(fixture, 'src/app.js'), "console.log('hello')\n")
const git = (...args) => execFileSync('git', args, { cwd: fixture, stdio: 'ignore' })
git('init', '-q', '-b', 'main')
git('-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', 'add', '.')
git('-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', 'commit', '-qm', 'init')

require(path.join(repoRoot, 'out/main/index.js'))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  // the app merges the login-shell env a few seconds after start; put fakes on PATH after that
  await wait(4000)
  process.env.PATH = path.join(__dirname, 'fakebin') + path.delimiter + process.env.PATH
  const win = BrowserWindow.getAllWindows()[0]
  const wc = win.webContents
  const logs = []
  const failures = []
  wc.on('console-message', (e) => e.level !== 'debug' && logs.push(`[${e.level}] ${e.message}`))
  const js = (code) => wc.executeJavaScript(code)
  const h = {
    out,
    fixture,
    wait,
    js,
    log: (...a) => logs.push(a.join(' ')),
    expect: (cond, msg) => {
      logs.push(`${cond ? 'PASS' : 'FAIL'} ${msg}`)
      if (!cond) failures.push(msg)
    },
    shot: async (file) => fs.writeFileSync(path.join(out, `${file}.png`), (await win.capturePage()).toPNG()),
    key: (keyCode, modifiers = []) => {
      for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode, modifiers })
    },
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
    /** open the fixture project with notifications off, then reload */
    openFixture: async (extra = {}) => {
      await js(`window.api.settings.set(${JSON.stringify({ rootFolder: fixture, notifications: false, sidebarVisible: true, ...extra })})`)
      wc.reload()
      await wait(3000)
    }
  }
  try {
    await require(path.join(__dirname, 'scenarios', `${name}.cjs`))(h)
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
