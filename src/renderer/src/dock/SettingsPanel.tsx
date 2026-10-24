import { useEffect, useState } from 'react'
import type { CustomAgent, VaultStatus } from '@shared/types'
import { Plus, Trash2 } from 'lucide-react'
import { useAgents } from '../state/agents'
import { applyTerminalFont } from '../lib/terminals'
import { useStore } from '../state/store'
import { updateSettings, workspace } from '../state/workspace'
import { openSetup } from '../state/setup'
import { AboutSection } from '../components/About'
import { LicenseSection } from '../components/License'

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
  return (
    <div className="panel-page settings">
      <div className="panel-page-head"><h2>Settings</h2></div>
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
          <span>Shell (empty = system default; applies to new terminals)</span>
          <input className="mono" value={shell} placeholder={window.api.platform === 'win32' ? 'powershell.exe' : '/bin/zsh'} onChange={(e) => setShell(e.target.value)} onBlur={() => updateSettings({ shell: shell.trim() || null })} />
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
        </label>
      </section>
      <section>
        <h3>Agents</h3>
        <AgentSettings />
        <label className="check">
          <input type="checkbox" checked={s.notifications} onChange={(e) => updateSettings({ notifications: e.target.checked })} />
          <span>Desktop notifications when a mission needs you or finishes</span>
        </label>
        <div className="field">
          <span>Claude Code hooks file (passed with --settings; your own Claude settings are untouched)</span>
          <code className="mono small selectable">{hooks}</code>
        </div>
      </section>
      <section>
        <h3>Setup</h3>
        <div className="field">
          <span>Check git, the GitHub CLI, Node.js, Docker and agent CLIs, and install what's missing.</span>
          <button type="button" className="btn sm" onClick={openSetup}>Open setup check</button>
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
        <span>Custom agents: any CLI. In commands, {'{prompt}'} {'{model}'} {'{name}'} are filled in; without {'{prompt}'} the prompt is appended.</span>
        {custom.map((c) => (
          <div key={c.id} className="custom-agent" onBlur={() => updateSettings({ customAgents: custom })}>
            <div className="field-row">
              <input value={c.name} placeholder="Name (e.g. Aider)" onChange={(e) => edit(c.id, { name: e.target.value })} />
              <button type="button" className="icon-btn" title="Remove" onClick={() => save(custom.filter((x) => x.id !== c.id))}>
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
