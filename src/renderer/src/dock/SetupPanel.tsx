import { useEffect } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import type { SetupCheck, SetupLevel } from '@shared/types'
import { agentInstallCommand } from '../lib/setup'
import { useAgents } from '../state/agents'
import { checkSetup, runSetupCommand, setup } from '../state/setup'
import { useStore } from '../state/store'

const SECTIONS: Array<{ level: SetupLevel; title: string }> = [
  { level: 'required', title: 'Required' },
  { level: 'recommended', title: 'Recommended' },
  { level: 'optional', title: 'Optional' }
]

const STATE_LABEL: Record<SetupCheck['state'], string> = { ok: 'Ready', missing: 'Not installed', 'not-ready': 'Needs setup' }

export function SetupPanel(): React.JSX.Element {
  const report = useStore(setup, (s) => s.report)
  const checking = useStore(setup, (s) => s.checking)
  const agents = useAgents().filter((a) => !a.custom)
  useEffect(() => {
    if (!setup.get().report) void checkSetup()
  }, [])
  const anyAgent = agents.some((a) => a.installed)

  return (
    <div className="panel-page settings setup">
      <div className="panel-page-head">
        <h2>Setup</h2>
        <span className="muted">
          {report ? `${platformName(report.platform)} · ${report.packageManager ? `installs with ${report.packageManager}` : 'no package manager found'}` : 'Checking…'}
        </span>
        <button className="btn sm setup-recheck" disabled={checking} onClick={() => void checkSetup(true)}>
          <RefreshCw size={13} /> {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <p className="setup-intro">
        sldev-io drives tools that are already on your machine. Install and log-in commands open in a terminal below, so you
        can see what runs and answer password prompts. The check runs again when a command finishes.
        {window.api.platform === 'win32' && ' On Windows, restart sldev-io after installing so it picks up the new PATH.'}
      </p>
      {report &&
        SECTIONS.map(({ level, title }) => {
          const checks = report.checks.filter((c) => c.level === level)
          return (
            checks.length > 0 && (
              <section key={level}>
                <h3>{title}</h3>
                {checks.map((c) => (
                  <SetupRow key={c.id} check={c} />
                ))}
              </section>
            )
          )
        })}
      <section>
        <h3>Agent CLIs {anyAgent ? '' : '· install at least one'}</h3>
        {agents.map((a) => (
          <SetupRow
            key={a.id}
            check={{
              id: a.id,
              name: a.name,
              why: a.installed ? `${a.bin} is on your PATH.` : `Runs missions and tasks with ${a.name}.`,
              level: 'optional',
              state: a.installed === false ? 'missing' : 'ok',
              install: agentInstallCommand(a.install, window.api.platform),
              docs: ''
            }}
            pending={a.installed === undefined}
          />
        ))}
      </section>
    </div>
  )
}

function SetupRow({ check: c, pending }: { check: SetupCheck; pending?: boolean }): React.JSX.Element {
  const tone = c.state === 'ok' ? 'is-ok' : c.level === 'required' ? 'is-bad' : 'is-warn'
  const command = c.state === 'missing' ? c.install : c.state === 'not-ready' ? c.fix : undefined
  return (
    <div className={`setup-row ${tone}`} data-check={c.id}>
      <span className={`setup-dot ${pending ? '' : tone}`} />
      <div className="setup-main">
        <div className="setup-title">
          <span>{c.name}</span>
          {c.version && <code>{c.version}</code>}
          <span className={`setup-state ${tone}`}>{pending ? '…' : STATE_LABEL[c.state]}</span>
        </div>
        <div className="setup-why">{c.detail ?? c.why}</div>
        {command && <code className="setup-cmd selectable">{command}</code>}
      </div>
      <div className="setup-actions">
        {command && (
          <button className="btn sm" onClick={() => runSetupCommand(command, `${c.state === 'missing' ? 'install' : 'set up'} ${c.name}`)}>
            {c.state === 'missing' ? 'Install' : 'Fix'}
          </button>
        )}
        {c.state !== 'ok' && c.docs && (
          <button className="icon-btn" title="Installation guide" aria-label="Installation guide" onClick={() => void window.api.shell.openExternal(c.docs)}>
            <ExternalLink size={13} />
          </button>
        )}
      </div>
    </div>
  )
}

function platformName(p: string): string {
  return p === 'darwin' ? 'macOS' : p === 'win32' ? 'Windows' : p === 'linux' ? 'Linux' : p
}
