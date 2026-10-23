import { useEffect, useState } from 'react'
import type { VaultStatus } from '@shared/types'
import { applyTerminalFont } from '../lib/terminals'
import { useStore } from '../state/store'
import { updateSettings, workspace } from '../state/workspace'

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
    </div>
  )
}
