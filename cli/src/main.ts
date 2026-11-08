import { resolve } from 'path'
import { parseArgs } from 'util'
import { allAgents, installedBin, setInstalledBins } from '@shared/agents'
import { BUILTIN_KINDS } from '@shared/missionKinds'
import { describeRepeat, parseGap, type RepeatPlan } from '@shared/repeat'
import { missionSignal, passSignal } from '@shared/status'
import { findOnPath } from '../../src/main/launch'
import { listKinds } from '../../src/main/missionKinds'
import { createInterface } from 'readline/promises'
import { describeClean, planClean, runClean } from './clean'
import { connect } from './client'
import { openPane, preferredEditor, runTerminalEditor } from './editor'
import { loadRuns, runColumns } from './workflows'
import { startDaemon } from './daemon'
import { dataDir } from './paths'
import type { LoopInfo, PaneInfo, WaitFor } from './protocol'
import { memorySummary, projectRoot, recallNotes, rememberNote, rulesInit, rulesStatus, rulesSync, skillsInstall, skillsStatus } from './repo'
import { defaultServices, runTui } from './tui'
import { claudeUsage, codexUsage, periodStart, usageTable } from './usage'
import { VERSION } from './version'

const USAGE = `sldev ${VERSION}: run coding agents side by side in your terminal

  sldev                         attach: every agent, its status, and its screen
                                (Ctrl-b w workflows, e editor, v changed files in the editor)
  sldev new [options] "brief"   start an agent in a new pane (prints its id)
      --agent <id>              claude, codex, cursor, copilot, opencode, gemini (default claude)
      --kind <kind>             frame the brief as a mission kind (build, research, plan, review…)
      --worktree <branch>       run in a new git worktree; --here keeps it in this folder
      --title, --model, --mode, --effort
      --failover <a,b>          continue on these agents when this one hits its usage limit
      --print                   the agent does the task and exits, no questions (its exit means done)
      --repeat <n>              run the brief n times, each pass building on the last (0: until a pass
                                changes nothing); every pass is committed in the loop's worktree
        --gap <30m>             wait this long after a pass is over before the next (s, m, h)
        --check "<cmd>"         run after each pass; a failure goes to the next pass, two stop the loop
        --accept                passes are interactive and end on sldev accept, not on the agent's exit
        --keep-going            don't stop when a pass changes nothing
  sldev ls [--json]             panes with agent, status and branch
  sldev send <pane> "text"      type into a pane (Enter included; --no-enter to leave it out)
  sldev read <pane> [--lines n] the pane's screen as text
  sldev wait [<pane>] --for ready|needs-you|done|idle [--timeout s]
  sldev review <pane> --agent <id>   a second agent reviews that pane's changes, read-only
  sldev accept <pane>           a pass that waits for you is good: stop it, the loop goes on
  sldev loops [--json]          repeat loops: their passes and what's next
  sldev loops stop <loop>       no pass after the running one
  sldev open <pane> [--diff]    the pane's folder in your editor; --diff: its changed files side by side
      --editor <id>             cursor, vscode, windsurf, zed, sublime, idea, nvim… (default: the app's
                                preferred editor, else the first one found)
  sldev workflows [--json]      the repo's latest GitHub Actions runs (needs the GitHub CLI, signed in)
  sldev clean                   finished panes leave the list and their worktrees are removed (asks first)
      --orphans                 also sldev worktrees no pane knows about (never ones the app uses)
      --discard                 remove worktrees with uncommitted files too
      --branches                delete their branches when every commit is on the base
      --dry-run, --yes          only show the plan / don't ask
  sldev kill <pane>             stop a pane's agent (its files stay)
  sldev stop                    stop the daemon and every agent in it

  sldev rules [status|init|sync [--overwrite <ids>]]   one .sldev/rules.md for every agent
  sldev skills [status|install [--overwrite <names>]] skills that let agents draft missions, stories,
                                                       recipes and evals for the sldev-io app
  sldev remember "note" [--files a,b]                  add a line to .sldev/memory.md
  sldev recall [topic] [--path <file>]                 search the project's memory and docs
  sldev memory                                         where the memory is, how big
  sldev usage [--week]                                 tokens and estimated cost, from local logs
  sldev agents | sldev kinds                           what's installed, what kinds exist

Panes run in a background daemon (sldev serve), so they keep going when you detach.
Nothing here talks to the network, except the workflows view, which asks GitHub through your gh.`

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

function loopLine(l: LoopInfo): string {
  const passes = l.progress.passes.map((p) => `${p.n}:${passSignal(p.outcome).label.toLowerCase()} (pane ${p.mission})`).join(', ')
  return `${l.id.padStart(3)}  ${l.name}\n     ${describeRepeat(l.plan)}\n     ${l.label}${l.stopping && l.progress.state !== 'finished' ? ' (stops after this pass)' : ''}${passes ? `\n     passes: ${passes}` : ''}`
}

/** --repeat and its options as a plan; undefined without --repeat. */
function repeatPlan(v: { repeat?: string; gap?: string; check?: string; accept?: boolean; 'keep-going'?: boolean }): RepeatPlan | undefined {
  if (v.repeat === undefined) {
    if (v.gap !== undefined || v.check !== undefined || v.accept || v['keep-going']) fail('--gap, --check, --accept and --keep-going go with --repeat <n>')
    return undefined
  }
  const times = Number(v.repeat)
  if (!Number.isInteger(times) || times < 0 || times > 50) fail('--repeat takes a number of passes from 0 (until nothing changes) to 50')
  const gapMinutes = v.gap === undefined ? 0 : parseGap(v.gap)
  if (gapMinutes === undefined) fail(`--gap "${v.gap}" isn't a duration; try 30s, 10m or 1h`)
  return { times, gapMinutes, check: v.check?.trim() || undefined, doneWhen: v.accept ? 'accept' : 'exit', keepGoingUnchanged: v['keep-going'] || undefined }
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
      return runTui(await client(), process.cwd(), undefined, defaultServices(() => preferredEditor(data)))
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
        cwd: { type: 'string' },
        print: { type: 'boolean' },
        repeat: { type: 'string' },
        gap: { type: 'string' },
        check: { type: 'string' },
        accept: { type: 'boolean' },
        'keep-going': { type: 'boolean' }
      })
      const brief = positionals.join(' ')
      const repeat = repeatPlan(values)
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
        print: values.print,
        repeat,
        cols: process.stdout.columns,
        rows: process.stdout.rows
      })
      c.close()
      if (repeat) process.stderr.write(`loop ${p.repeat?.loop}: ${describeRepeat(repeat)}; pass 1 is pane ${p.id}\n`)
      return void console.log(p.id)
    }
    case 'open': {
      const { values, positionals } = opts({ diff: { type: 'boolean' }, editor: { type: 'string' } })
      if (!positionals[0]) return fail('sldev open <pane> [--diff] [--editor <id>]')
      const c = await client()
      const p = (await c.request('ls', {})).find((x) => x.id === positionals[0] || x.title === positionals[0])
      c.close()
      if (!p) return fail(`No pane "${positionals[0]}". See sldev ls.`)
      const r = await openPane(p, { diff: values.diff, editor: values.editor, preferred: preferredEditor(data) })
      console.log(r.note)
      if (r.terminal) runTerminalEditor(r.terminal, p.cwd)
      return
    }
    case 'workflows': {
      const { values } = opts({ json: { type: 'boolean' } })
      const runs = await loadRuns(process.cwd())
      if (values.json) return void console.log(JSON.stringify(runs, null, 2))
      if (!runs.length) return void console.log('No workflow runs yet in this repository.')
      return void console.log(runs.slice(0, 20).map((r) => {
        const col = runColumns(r)
        return `${String(r.databaseId).padStart(12)}  ${col.label.padEnd(9)} ${col.text}`
      }).join('\n'))
    }
    case 'clean': {
      const { values } = opts({ orphans: { type: 'boolean' }, discard: { type: 'boolean' }, branches: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, yes: { type: 'boolean' } })
      const c = await connect({ dataDir: data, script: script(), start: false }).catch(() => null)
      const [panes, loopList] = c ? await Promise.all([c.request('ls', {}), c.request('loops', {})]) : [[], []]
      const o = { orphans: values.orphans, discard: values.discard, branches: values.branches, repo: await projectRoot(process.cwd()), dataDir: data }
      const items = await planClean(panes, loopList, o)
      if (!items.length) {
        c?.close()
        return void console.log(values.orphans ? 'Nothing to clean: no finished panes, and no sldev worktrees nobody uses.' : 'Nothing to clean: no finished panes. --orphans also looks for sldev worktrees no pane knows about.')
      }
      console.log(describeClean(items).join('\n'))
      const doing = items.filter((i) => !i.keep)
      if (!doing.length || values['dry-run']) return void c?.close()
      if (!values.yes) {
        if (!process.stdin.isTTY) {
          c?.close()
          return fail('nothing removed: pass --yes to clean without asking')
        }
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        const answer = await rl.question(`Remove ${doing.filter((i) => i.worktree).length} worktree(s) and ${doing.filter((i) => i.pane).length} pane(s) from the list? (y/N) `)
        rl.close()
        if (!/^y/i.test(answer.trim())) {
          c?.close()
          return void console.log('Nothing removed.')
        }
      }
      const problems = await runClean(items, o, async (id) => void (await c?.request('kill', { pane: id })))
      c?.close()
      if (problems.length) return fail(`some things stayed:\n${problems.map((p) => `  ${p}`).join('\n')}`)
      return void console.log('Cleaned.')
    }
    case 'accept': {
      if (!rest[0]) return fail('sldev accept <pane>')
      const c = await client()
      await c.request('accept', { pane: rest[0] })
      return c.close()
    }
    case 'loops': {
      const { values, positionals } = opts({ json: { type: 'boolean' } })
      const c = await client()
      if (positionals[0] === 'stop') {
        if (!positionals[1]) return fail('sldev loops stop <loop>')
        const l = await c.request('loop-stop', { loop: positionals[1] })
        c.close()
        return void console.log(loopLine(l))
      }
      const all = await c.request('loops', {})
      c.close()
      if (values.json) return void console.log(JSON.stringify(all, null, 2))
      return void console.log(all.length ? all.map(loopLine).join('\n') : 'No loops. Start one with sldev new --repeat 3 "…"')
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
    case 'skills': {
      const { values, positionals } = opts({ overwrite: { type: 'string' } })
      const root = await projectRoot(process.cwd())
      const sub = positionals[0] ?? 'status'
      if (sub === 'status') return void console.log(await skillsStatus(root))
      if (sub === 'install') return void console.log(await skillsInstall(root, list(values.overwrite)))
      return fail('sldev skills [status|install]')
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
