// A mission prompt full of shell metacharacters reaches the agent as one exact argument (it once
// arrived on Windows as the single word "need").
const fs = require('fs')
const os = require('os')
const path = require('path')

const log = path.join(os.tmpdir(), `sldev-e2e-argv-${process.pid}.jsonl`)
const PROMPT = [
  'I need you to create a document',
  `with "double" and 'single' quotes & ampersands | pipes > redirects`,
  '%PATH% $HOME `backticks` !bang!',
  'non-ASCII: café 日本語',
  'trailing backslash \\'
].join('\n')

module.exports = async (h) => {
  fs.rmSync(log, { force: true })
  await h.openFixture()
  h.key('3', ['control', 'shift'])
  await h.wait(500)
  await h.click('.btn', 'New mission')
  await h.wait(400)
  await h.setValue('.form select', 'claude', `e.querySelector('option[value=claude]')`)
  await h.setValue('.form textarea', PROMPT)
  await h.wait(200)
  await h.click('.form .btn.primary', 'Launch')
  h.expect(await h.until(async () => fs.existsSync(log), 10000), 'fake claude started')
  const argv = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n')[0])
  const last = argv[argv.length - 1]
  h.expect(last.startsWith('Mission: I need you to create a document\n\n') && last.includes(PROMPT), `the prompt is the last argument, intact (got ${JSON.stringify(last)})`)
  const n = argv.indexOf('-n')
  h.expect(n >= 0 && argv[n + 1] === 'I need you to create a document', `the session name is one argument (got ${JSON.stringify(argv[n + 1])})`)
  await h.wait(1500)
  await h.shot('1-mission-started')
}

module.exports.env = { SLDEV_E2E_ARGV: log }
