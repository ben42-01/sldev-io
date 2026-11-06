import { useEffect, useRef, useState } from 'react'
import type { CustomAgent, ThemePref, VaultStatus } from '@shared/types'
import { clampZoom, UI_ZOOMS } from '@shared/theme'
import { Plus, Trash2 } from 'lucide-react'
import { useAgents } from '../state/agents'
import { applyTerminalFont } from '../lib/terminals'
import { scrollToTop } from '../lib/scroll'
import { useStore } from '../state/store'
import { updateSettings, workspace } from '../state/workspace'
import { openSetup } from '../state/setup'
import { AboutSection } from '../components/About'
import { LicenseSection } from '../components/License'
import { AgentProfiles } from '../components/AgentProfiles'

export function SettingsPanel(): React.JSX.Element {
  const s = useStore(workspace, (w) => w)
  const [vault, setVault] = useState<VaultStatus | null>(null)
  const [hooks, setHooks] = useState<string>('')
  const [hotkey, setHotkey] = useState(s.globalHotkey ?? '')
  const [shell, setShell] = useState(s.shell ?? '')
  useEffect(() => {
    void window.api.vault.status().then(setVault)
    void window.api.missions.hookInfo().then((h) => setHooks(h?.settingsPath ?? 'unavailable'))
  }, [])
  const font = (family: string, size: number): void => {
    updateSettings({ terminalFontFamily: family, terminalFontSize: size })
    applyTerminalFont(family, size)
  }
  const page = useRef<HTMLDivElement>(null)
  return (
    <div className="panel-page settings" ref={page}>
      <div className="panel-page-head"><h2>Settings</h2></div>
      <SectionNav page={page} />
      <section>
        <h3>Appearance</h3>
        <ThemePicker />
        <label className="field narrow-select">
          <span>Interface size</span>
          <select value={String(clampZoom(s.uiZoom))} onChange={(e) => updateSettings({ uiZoom: Number(e.target.value) })}>
            {UI_ZOOMS.map((z) => <option key={z.value} value={String(z.value)}>{z.label}</option>)}
          </select>
          <span className="field-hint">Scales the whole window: sidebars, cards and text. Terminal text keeps its own font size on top.</span>
        </label>
      </section>
      <section>
        <h3>Terminal</h3>
        <label className="field">
          <span>Font family</span>
          <input className="mono" value={s.terminalFontFamily} onChange={(e) => font(e.target.value, s.terminalFontSize)} />
        </label>
        <label className="field narrow">
          <span>Font size</span>
          <input type="number" min={8} max={32} value={s.terminalFontSize} onChange={(e) => font(s.terminalFontFamily, Number(e.target.value) || 13)} />
        </label>
        <label className="field">
          <span>Tab layout</span>
          <select value={s.tabLayout} onChange={(e) => updateSettings({ tabLayout: e.target.value as 'top' | 'side' })}>
            <option value="top">Tabs on top</option>
            <option value="side">Tabs in a side list</option>
          </select>
        </label>
        <label className="field">
          <span>Shell</span>
          <input className="mono" value={shell} placeholder={window.api.platform === 'win32' ? 'powershell.exe' : '/bin/zsh'} onChange={(e) => setShell(e.target.value)} onBlur={() => updateSettings({ shell: shell.trim() || null })} />
          <span className="field-hint">Empty uses the system default. Applies to new terminals.</span>
        </label>
      </section>
      <section>
        <h3>Editor</h3>
        <label className="field">
          <span>Open files and folders with</span>
          <select value={s.preferredEditor ?? ''} onChange={(e) => updateSettings({ preferredEditor: e.target.value || null })}>
            <option value="">Automatic (first detected)</option>
            {s.editors.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <span className="field-hint">VS Code, Cursor, Windsurf and JetBrains IDEs can also show a mission's changes in their own diff view.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.reviewFocus !== false} onChange={(e) => updateSettings({ reviewFocus: e.target.checked })} />
          <span>Hide the sidebars while a review tab is on screen</span>
        </label>
      </section>
      <section>
        <h3>Agents</h3>
        <AgentSettings />
        <FailoverSettings />
        <AgentProfiles />
        <label className="check">
          <input type="checkbox" checked={s.agentTools !== false} onChange={(e) => updateSettings({ agentTools: e.target.checked })} />
          <span>Give Claude Code and Codex missions the sldev tools (MCP): they report their own status, hand over results and can read other missions</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.projectMemory !== false} onChange={(e) => updateSettings({ projectMemory: e.target.checked })} />
          <span>Project context: point missions at .sldev/memory.md and at the notes, docs (.sldev/context), pinned files and skills that match their brief, and let agents with the sldev tools look things up and add what they learn (Freeform missions get nothing added)</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.notifications} onChange={(e) => updateSettings({ notifications: e.target.checked })} />
          <span>Desktop notifications when a mission needs you or finishes</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.notificationSound} onChange={(e) => updateSettings({ notificationSound: e.target.checked })} />
          <span>Play a sound when a mission needs you</span>
        </label>
        <div className="field">
          <span>Claude Code hooks file</span>
          <code className="mono small selectable">{hooks}</code>
          <span className="field-hint">Passed with --settings. Your own Claude settings are untouched.</span>
        </div>
      </section>
      <section>
        <h3>Software Factory</h3>
        <FactorySettings />
      </section>
      <section>
        <h3>Setup</h3>
        <div className="field">
          <span>Tools</span>
          <button type="button" className="btn sm" onClick={openSetup}>Open setup check</button>
          <span className="field-hint">Checks git, the GitHub CLI, Node.js, Docker and agent CLIs, and installs what's missing.</span>
        </div>
      </section>
      <section>
        <h3>Window</h3>
        <label className="field">
          <span>Global show/hide hotkey (Electron accelerator, empty = off)</span>
          <input className="mono" value={hotkey} placeholder="CommandOrControl+Shift+Space" onChange={(e) => setHotkey(e.target.value)} onBlur={() => updateSettings({ globalHotkey: hotkey.trim() || null })} />
        </label>
      </section>
      <section>
        <h3>Security</h3>
        <div className="field">
          <span>Credential encryption</span>
          <div className={vault?.encrypted ? 'ok' : 'bad'}>{vault ? (vault.encrypted ? `Encrypted with the OS keychain (${vault.backend})` : `Not securely encrypted (backend: ${vault.backend})`) : '…'}</div>
        </div>
      </section>
      <LicenseSection />
      <AboutSection />
    </div>
  )
}

const THEMES: Array<{ id: ThemePref; label: string; hint: string }> = [
  { id: 'dark', label: 'Dark', hint: 'The default' },
  { id: 'light', label: 'Light', hint: 'For bright rooms' },
  { id: 'system', label: 'Match system', hint: 'Follows your OS' }
]

/** Three tiles, each a tiny window drawn in that theme, so the choice is visible before it's made. */
function ThemePicker(): React.JSX.Element {
  const pref = useStore(workspace, (w) => w.theme ?? 'dark')
  return (
    <div className="field">
      <span>Theme</span>
      <div className="theme-picker" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={pref === t.id}
            className={`theme-tile${pref === t.id ? ' on' : ''}`}
            onClick={() => updateSettings({ theme: t.id })}
          >
            <span className={`theme-swatch swatch-${t.id}`} aria-hidden>
              <span className="sw-bar" />
              <span className="sw-side" />
              <span className="sw-main">
                <i />
                <i />
                <i className="short" />
              </span>
            </span>
            <span className="theme-tile-label">{t.label}</span>
            <span className="theme-tile-hint">{t.hint}</span>
          </button>
        ))}
      </div>
      <span className="field-hint">Terminals, notes and the window frame change with it. Status colours keep their meaning in both.</span>
    </div>
  )
}

/** Jump links to every section heading on the page, read from the DOM so sections from other components count too. */
function SectionNav({ page }: { page: React.RefObject<HTMLDivElement | null> }): React.JSX.Element {
  const [heads, setHeads] = useState<HTMLElement[]>([])
  useEffect(() => {
    setHeads([...(page.current?.querySelectorAll<HTMLElement>(':scope > section > h3') ?? [])])
  }, [page])
  return (
    <nav className="settings-nav" aria-label="Settings sections">
      {heads.map((h) => (
        <button key={h.textContent} type="button" onClick={() => scrollToTop(h.parentElement, 'smooth')}>
          {h.textContent}
        </button>
      ))}
    </nav>
  )
}

/** Where work goes when an agent stops at its plan's usage limit. */
function FailoverSettings(): React.JSX.Element {
  const agents = useAgents().filter((a) => !a.custom)
  const order = useStore(workspace, (w) => w.failoverOrder ?? [])
  const auto = useStore(workspace, (w) => w.failoverAuto)
  const toggle = (id: string, on: boolean): void => updateSettings({ failoverOrder: on ? [...order.filter((x) => x !== id), id] : order.filter((x) => x !== id) })
  return (
    <>
      <div className="field">
        <span>When an agent hits its usage limit, continue on</span>
        <div className="failover-list">
          {agents.map((a) => {
            const i = order.indexOf(a.id)
            return (
              <label key={a.id} className="check">
                <input type="checkbox" checked={i >= 0} onChange={(e) => toggle(a.id, e.target.checked)} />
                <span>
                  {i >= 0 ? <b className="failover-rank">{i + 1}</b> : null}
                  {a.name}
                  {a.installed === false ? ' (not installed)' : ''}
                </span>
              </label>
            )
          })}
        </div>
        <span className="field-hint">
          Tick them in the order to try. The next agent gets the original task, the work so far (it stays in the same folder) and the last
          output of the one that stopped. The agent that stopped is skipped.
        </span>
      </div>
      <label className="check">
        <input type="checkbox" checked={auto} disabled={!order.length} onChange={(e) => updateSettings({ failoverAuto: e.target.checked })} />
        <span>Continue automatically, without asking (missions and factory stages). Off: the mission shows a Continue button.</span>
      </label>
    </>
  )
}

/** Stages run in print mode with nobody to approve a tool call, so each agent gets a mode that lets it work alone. */
function FactorySettings(): React.JSX.Element {
  const agents = useAgents().filter((a) => a.modes.length > 0)
  const modes = useStore(workspace, (w) => w.factoryModes ?? {})
  const pick = (id: string, value: string | undefined): void => {
    const next = { ...modes }
    if (value === undefined) delete next[id]
    else next[id] = value
    updateSettings({ factoryModes: next })
  }
  const label = (a: (typeof agents)[number], v: string | undefined): string => a.modes.find((m) => m.value === v)?.label ?? 'CLI default'
  return (
    <>
      <div className="field">
        <span>
          Permission mode for agent stages. Stages run unattended in their own worktree, so a mode that asks before every edit or command
          leaves them unable to do anything. A stage's agent profile can set its own mode.
        </span>
      </div>
      {agents.map((a) => (
        <label key={a.id} className="field">
          <span>{a.name}</span>
          <select value={modes[a.id] ?? '__recommended'} onChange={(e) => pick(a.id, e.target.value === '__recommended' ? undefined : e.target.value)}>
            <option value="__recommended">Recommended: {label(a, a.unattendedMode)}</option>
            {a.modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            <option value="">CLI default</option>
          </select>
        </label>
      ))}
    </>
  )
}

function AgentSettings(): React.JSX.Element {
  const agents = useAgents()
  const defaultAgent = useStore(workspace, (w) => w.defaultAgent)
  const saved = useStore(workspace, (w) => w.customAgents)
  const [custom, setCustom] = useState<CustomAgent[]>(saved)
  const save = (list: CustomAgent[]): void => {
    setCustom(list)
    updateSettings({ customAgents: list })
  }
  const edit = (id: string, patch: Partial<CustomAgent>): void => setCustom((l) => l.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const add = (): void => save([...custom, { id: `custom-${Date.now().toString(36)}`, name: '', command: '' }])

  return (
    <>
      <label className="field">
        <span>Default agent for new missions and tasks</span>
        <select value={defaultAgent} onChange={(e) => updateSettings({ defaultAgent: e.target.value })}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.installed === false ? ' (not installed)' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="agent-grid">
        {agents
          .filter((a) => !a.custom)
          .map((a) => (
            <div key={a.id} className="agent-chip" title={a.installed === false && a.install ? `Install: ${a.install}` : a.bin}>
              <span className={`agent-dot${a.installed ? ' on' : ''}`} />
              <span>{a.name}</span>
              <code>{a.bin}</code>
            </div>
          ))}
      </div>
      <div className="field">
        <span>Custom agents</span>
        <span className="field-hint">Any CLI. In commands, {'{prompt}'} {'{model}'} {'{name}'} are filled in; without {'{prompt}'} the prompt is appended.</span>
        {custom.map((c) => (
          <div key={c.id} className="custom-agent" onBlur={() => updateSettings({ customAgents: custom })}>
            <div className="field-row">
              <input value={c.name} placeholder="Name (e.g. Aider)" onChange={(e) => edit(c.id, { name: e.target.value })} />
              <button type="button" className="icon-btn" title="Remove" aria-label="Remove" onClick={() => save(custom.filter((x) => x.id !== c.id))}>
                <Trash2 size={13} />
              </button>
            </div>
            <input className="mono" value={c.command} placeholder="Interactive command, e.g. aider" onChange={(e) => edit(c.id, { command: e.target.value })} />
            <input className="mono" value={c.printCommand ?? ''} placeholder="Non-interactive (optional): aider --message {prompt} --yes" onChange={(e) => edit(c.id, { printCommand: e.target.value || undefined })} />
            <input className="mono" value={c.resumeCommand ?? ''} placeholder="Continue last session (optional): aider --restore-chat-history" onChange={(e) => edit(c.id, { resumeCommand: e.target.value || undefined })} />
          </div>
        ))}
        <button type="button" className="btn sm" onClick={add}>
          <Plus size={13} /> Add custom agent
        </button>
      </div>
    </>
  )
}
