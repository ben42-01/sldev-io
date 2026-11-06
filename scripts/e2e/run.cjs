// End-to-end harness: boots the built app (out/) against a throwaway git repo and a temp userData,
// with fake agent CLIs (scripts/e2e/fakebin) first on PATH, then runs a scenario that drives the UI.
//
//   npm run e2e -- missions            # scripts/e2e/scenarios/missions.cjs
//
// Screenshots + console.log land in .e2e-out/<scenario>/. Exit code 1 if any h.expect() failed.
const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('child_process')
const fs = require('fs')
const http = require('http')
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
// run as the real app version (beta builds honour the beta window) unless the scenario wants another
app.setVersion(process.env.SLDEV_E2E_VERSION || require(path.join(repoRoot, 'package.json')).version)

// stand-in for the website's /beta.json; scenarios change it with h.setBeta()
let betaConfig = { startsAt: null, endsAt: null }
const betaServer = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(betaConfig))
})
betaServer.unref()

// stand-in for the website's /api/license/*, with its own key pair; scenarios edit h.licenses
const { generateKeyPairSync, sign } = require('crypto')
const licenseKeys = generateKeyPairSync('ed25519')
const licenses = new Map([['SLDEV-TEST-GOOD', { lid: 'lic-1', plan: 'personal', email: 'buyer@example.com', limit: 3, revoked: false, activations: new Map() }]])
const signToken = (claims) => {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${body}.${sign(null, Buffer.from(body), licenseKeys.privateKey).toString('base64url')}`
}
const licenseServer = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const body = JSON.parse(raw || '{}')
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    }
    const l = licenses.get(body.key)
    if (!l) return reply(403, { error: "That license key isn't valid. Check it against your receipt email." })
    if (l.revoked) return reply(403, { error: 'This license is no longer active on this machine.' })
    const claimsOf = (t) => JSON.parse(Buffer.from(String(t).split('.')[0], 'base64url').toString())
    const issue = (machine, aid) => {
      const now = Date.now()
      return reply(200, { token: signToken({ v: 1, lid: l.lid, aid, plan: l.plan, machine, email: l.email, iat: now, exp: now + 45 * 86_400_000 }) })
    }
    if (req.url.endsWith('/activate')) {
      if (!l.activations.has(body.machine) && l.activations.size >= l.limit) return reply(403, { error: 'This license is already active on the maximum number of machines.' })
      if (!l.activations.has(body.machine)) l.activations.set(body.machine, `act-${l.activations.size + 1}`)
      return issue(body.machine, l.activations.get(body.machine))
    }
    const c = claimsOf(body.token)
    if (req.url.endsWith('/refresh')) return [...l.activations.values()].includes(c.aid) ? issue(c.machine, c.aid) : reply(403, { error: 'This license is no longer active on this machine.' })
    if (req.url.endsWith('/deactivate')) {
      l.activations.delete(c.machine)
      return reply(200, {})
    }
    reply(404, { error: 'not found' })
  })
})
licenseServer.unref()
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
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

// fakes that only record what they were asked (fakebin/code) write next to the fixture
process.env.SLDEV_E2E_TMP = tmp
betaServer.listen(0, '127.0.0.1', () => {
  process.env.SLDEV_BETA_CONFIG_URL = `http://127.0.0.1:${betaServer.address().port}/beta.json`
  licenseServer.listen(0, '127.0.0.1', () => {
    // a scenario that sets SLDEV_LICENSE_API talks to that server with the app's built-in public key
    if (!process.env.SLDEV_LICENSE_API) {
      process.env.SLDEV_LICENSE_API = `http://127.0.0.1:${licenseServer.address().port}/api/license`
      process.env.SLDEV_LICENSE_PUBLIC_KEY = licenseKeys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
    }
    // always the built renderer: a harness started from a terminal inside `npm run dev` inherits the dev server's
    // URL, and would otherwise test whatever that server serves instead of out/
    delete process.env.ELECTRON_RENDERER_URL
    require(path.join(repoRoot, 'out/main/index.js'))
  })
})

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
    /** the fake license server's keys: key → { lid, plan, email, limit, revoked, activations } */
    licenses,
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
    /** serve this beta window from the fake /beta.json; days are offsets from today (null = unset) */
    setBeta: ({ startsInDays = null, endsInDays = null } = {}) => {
      betaConfig = {
        startsAt: startsInDays === null ? null : daysFromNow(startsInDays),
        endsAt: endsInDays === null ? null : daysFromNow(endsInDays)
      }
      return betaConfig
    },
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
