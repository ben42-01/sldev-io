import { resolve } from 'path'
import { parseArgs } from 'util'
import { allAgents, installedBin, setInstalledBins } from '@shared/agents'
import { BUILTIN_KINDS } from '@shared/missionKinds'
import { missionSignal } from '@shared/status'
import { findOnPath } from '../../src/main/launch'
import { listKinds } from '../../src/main/missionKinds'
import { connect } from './client'
import { startDaemon } from './daemon'
import { dataDir } from './paths'
import type { PaneInfo, WaitFor } from './protocol'
import { memorySummary, projectRoot, recallNotes, rememberNote, rulesInit, rulesStatus, rulesSync } from './repo'
import { runTui } from './tui'
import { claudeUsage, codexUsage, periodStart, usageTable } from './usage'
import { VERSION } from './version'

const USAGE = `sldev ${VERSION}: run coding agents side by side in your terminal

  sldev                         attach: every agent, its status, and its screen
  sldev new [options] "brief"   start an agent in a new pane (prints its id)
      --agent <id>              claude, codex, cursor, copilot, opencode, gemini (default claude)
      --kind <kind>             frame the brief as a mission kind (build, research, plan, review…)
      --worktree <branch>       run in a new git worktree; --here keeps it in this folder
      --title, --model, --mode, --effort
      --failover <a,b>          continue on these agents when this one hits its usage limit
  sldev ls [--json]             panes with agent, status and branch
  sldev send <pane> "text"      type into a pane (Enter included; --no-enter to leave it out)
  sldev read <pane> [--lines n] the pane's screen as text
  sldev wait [<pane>] --for ready|needs-you|done|idle [--timeout s]
  sldev review <pane> --agent <id>   a second agent reviews that pane's changes, read-only
  sldev kill <pane>             stop a pane's agent (its files stay)
  sldev stop                    stop the daemon and every agent in it

  sldev rules [status|init|sync [--overwrite <ids>]]   one .sldev/rules.md for every agent
  sldev remember "note" [--files a,b]                  add a line to .sldev/memory.md
  sldev recall [topic] [--path <file>]                 search the project's memory and docs
  sldev memory                                         where the memory is, how big
  sldev usage [--week]                                 tokens and estimated cost, from local logs
  sldev agents | sldev kinds                           what's installed, what kinds exist

Panes run in a background daemon (sldev serve), so they keep going when you detach.
Nothing here talks to the network.`

const script = (): string => resolve(process.argv[1] ?? '')

function fail(msg: string): never {
  process.stderr.write(`sldev: ${msg}\n`)
  process.exit(1)
}

function paneLine(p: PaneInfo): string {
  const sig = missionSignal(p.status)
  const where = p.worktree ? p.worktree.branch : 'in place'
  const stats = p.stats ? `  ${p.stats.files} files +${p.stats.insertions} -${p.stats.deletions}` : ''
  return `${p.id.padStart(3)}  ${p.agentName.padEnd(14)} ${sig.label.padEnd(13)} ${where.padEnd(24)} ${p.title}${stats}${p.notification ? `\n     ${p.notification}` : ''}`
}

const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv
  const data = dataDir()
  const client = (): ReturnType<typeof connect> => connect({ dataDir: data, script: script() })
  const opts = <T extends Record<string, { type: 'string' | 'boolean' }>>(options: T) => parseArgs({ args: rest, options, allowPositionals: true, strict: true })

  switch (cmd) {
    case undefined: {
      if (!process.stdout.isTTY || !process.stdin.isTTY) return fail('attaching needs a terminal; see sldev help')
      return runTui(await client(), process.cwd())
    }
    case 'help':
    case '-h':
    case '--help':
      return void console.log(USAGE)
    case '-v':
    case '--version':
    case 'version':
      return void console.log(VERSION)
    case 'serve': {
      const d = await startDaemon({ dataDir: data })
      console.log(`sldev ${VERSION} serving on ${d.socket}`)
      const stop = (): void => void d.close().then(() => process.exit(0))
      process.on('SIGTERM', stop)
      process.on('SIGINT', stop)
      return
    }
    case 'new': {
      const { values, positionals } = opts({
        agent: { type: 'string' },
        kind: { type: 'string' },
        worktree: { type: 'string' },
        here: { type: 'boolean' },
        title: { type: 'string' },
        model: { type: 'string' },
        mode: { type: 'string' },
        effort: { type: 'string' },
        failover: { type: 'string' },
        cwd: { type: 'string' }
      })
      const brief = positionals.join(' ')
      const c = await client()
      const p = await c.request('new', {
        agent: values.agent,
        brief,
        title: values.title,
        kind: values.kind,
        worktree: values.here ? false : values.worktree,
        cwd: resolve(values.cwd ?? process.cwd()),
        model: values.model,
        mode: values.mode,
        effort: values.effort,
        failover: values.failover !== undefined ? list(values.failover) : undefined,
        cols: process.stdout.columns,
        rows: process.stdout.rows
      })
      c.close()
      return void console.log(p.id)
    }
    case 'ls': {
      const { values } = opts({ json: { type: 'boolean' } })
      const c = await client()
      const panes = await c.request('ls', {})
      c.close()
      if (values.json) return void console.log(JSON.stringify(panes, null, 2))
      return void console.log(panes.length ? panes.map(paneLine).join('\n') : 'No panes. Start one with sldev new --agent claude "…"')
    }
    case 'send': {
      const { values, positionals } = opts({ 'no-enter': { type: 'boolean' } })
      const [pane, ...text] = positionals
      if (!pane || !text.length) return fail('sldev send <pane> "text"')
      const c = await client()
      await c.request('send', { pane, text: text.join(' '), enter: !values['no-enter'] })
      return c.close()
    }
    case 'read': {
      const { values, positionals } = opts({ lines: { type: 'string' } })
      if (!positionals[0]) return fail('sldev read <pane>')
      const c = await client()
      const { text } = await c.request('read', { pane: positionals[0], lines: values.lines ? Number(values.lines) : undefined })
      c.close()
      return void console.log(text)
    }
    case 'wait': {
      const { values, positionals } = opts({ for: { type: 'string' }, timeout: { type: 'string' }, json: { type: 'boolean' } })
      const c = await client()
      const p = await c.request('wait', { pane: positionals[0], for: (values.for ?? 'idle') as WaitFor, timeout: values.timeout ? Number(values.timeout) : undefined })
      c.close()
      if (!p) return fail('timed out')
      return void console.log(values.json ? JSON.stringify(p, null, 2) : paneLine(p))
    }
    case 'review': {
      const { values, positionals } = opts({ agent: { type: 'string' } })
      if (!positionals[0] || !values.agent) return fail('sldev review <pane> --agent <id>')
      const c = await client()
      const p = await c.request('review', { pane: positionals[0], agent: values.agent })
      c.close()
      return void console.log(p.id)
    }
    case 'kill': {
      if (!rest[0]) return fail('sldev kill <pane>')
      const c = await client()
      await c.request('kill', { pane: rest[0] })
      return c.close()
    }
    case 'stop': {
      const c = await connect({ dataDir: data, script: script(), start: false }).catch(() => null)
      if (!c) return void console.log('sldev is not running')
      await c.request('stop', {})
      return c.close()
    }
    case 'rules': {
      const { values, positionals } = opts({ overwrite: { type: 'string' } })
      const root = await projectRoot(process.cwd())
      const sub = positionals[0] ?? 'status'
      if (sub === 'status') return void console.log(await rulesStatus(root))
      if (sub === 'init') return void console.log(await rulesInit(root))
      if (sub === 'sync') return void console.log(await rulesSync(root, list(values.overwrite)))
      return fail('sldev rules [status|init|sync]')
    }
    case 'remember': {
      const { values, positionals } = opts({ files: { type: 'string' } })
      if (!positionals.length) return fail('sldev remember "note"')
      return void console.log(await rememberNote(await projectRoot(process.cwd()), positionals.join(' '), list(values.files)))
    }
    case 'recall': {
      const { values, positionals } = opts({ path: { type: 'string' } })
      return void console.log(await recallNotes(data, await projectRoot(process.cwd()), positionals.join(' '), values.path))
    }
    case 'memory':
      return void console.log(await memorySummary(await projectRoot(process.cwd())))
    case 'usage': {
      const { values } = opts({ week: { type: 'boolean' } })
      const since = periodStart(!!values.week)
      const rows = await Promise.all([claudeUsage(since), codexUsage(since)])
      return void console.log(usageTable(rows, values.week ? 'this week' : 'today'))
    }
    case 'agents': {
      const agents = allAgents()
      setInstalledBins(agents.flatMap((a) => [a.bin, ...(a.aliases ?? [])]).filter((b) => findOnPath(b, process.env)))
      return void console.log(agents.map((a) => `${a.id.padEnd(10)} ${a.name.padEnd(16)} ${installedBin(a) ? 'installed' : `not installed${a.install ? `: ${a.install}` : ''}`}`).join('\n'))
    }
    case 'kinds': {
      const kinds = [...BUILTIN_KINDS, ...(await listKinds(await projectRoot(process.cwd()), data))]
      return void console.log(kinds.map((k) => `${k.id.padEnd(14)} ${k.readOnly ? 'read-only ' : ''}${k.description}`).join('\n'))
    }
  }
  fail(`unknown command "${cmd}"; see sldev help`)
}

main(process.argv.slice(2)).catch((err: Error) => fail(err.message))
