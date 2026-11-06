// Windows twin of ../codex (a shell script, which Windows can't run): the same output, pauses, bell and
// questions, so the CLI tests run there too. Keep the two in step.
const fs = require('fs')
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const out = (s) => fs.writeSync(1, s)
/** one line from the terminal, like the shell's `read` */
function readLine() {
  const b = Buffer.alloc(1)
  let s = ''
  for (;;) {
    let n = 0
    try {
      n = fs.readSync(0, b, 0, 1, null)
    } catch (e) {
      if (e.code === 'EAGAIN') { sleep(50); continue }
      if (e.code === 'EOF') break
      throw e
    }
    if (!n) break
    const ch = b.toString()
    if (ch === '\r' || ch === '\n') break
    s += ch
  }
  return s
}

let args = process.argv.slice(2)
out(`fake codex: ${args.join(' ')}\n`)
if (args.includes('--full-auto')) {
  process.stderr.write("error: unexpected argument '--full-auto' found\n")
  process.exit(2)
}
while (args[0] === '-c') args = args.slice(2)
const prompt = args[args.length - 1] ?? ''
if (args[0] === 'exec') {
  const file = (prompt.match(/(?:[A-Za-z]:)?[\\/][^ ]*\.sldev[\\/]runs[\\/][^ ]*\.md/g) || []).pop()
  if (file) {
    fs.mkdirSync(require('path').dirname(file), { recursive: true })
    fs.writeFileSync(file, '# Output from fake codex\n')
  }
  const name = file ? `codex-${require('path').basename(file, '.md')}` : 'CODEX'
  fs.appendFileSync(`${name}.md`, `codex: ${prompt.split('\n')[0]}\n`)
  sleep(1000)
  out('done (exec)\n')
  process.exit(0)
}
if (args.join(' ').includes('ASK_SCREEN')) {
  out('thinking\n')
  sleep(1000)
  out('Would you like to run the following command?\n  $ npm test\n> 1. Yes, proceed\n  2. No, and tell Codex what to do differently\n')
  readLine()
  for (let i = 1; i <= 6; i++) { out(`running npm test ${i}\n`); sleep(500) }
  out('tests passed\n')
  sleep(60000)
  process.exit(0)
}
for (let i = 1; i <= 8; i++) { out(`thinking ${i}\n`); sleep(500) }
fs.appendFileSync('codex-change.txt', 'change from codex\n')
out('done editing\n')
sleep(9000)
out('Allow command `rm -rf build`? [y/N] \x07')
out(`you said ${readLine()}\n`)
