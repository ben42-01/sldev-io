import { useEffect, useState } from 'react'
import type { SshPrompt } from '@shared/types'
import { ShieldAlert, ShieldQuestion, KeyRound } from 'lucide-react'

/** Modal for questions the SSH layer asks: unknown/changed host keys, passwords, 2FA codes. */
export function PromptHost(): React.JSX.Element | null {
  const [queue, setQueue] = useState<SshPrompt[]>([])
  const [values, setValues] = useState<string[]>([])
  useEffect(() => window.api.ssh.onPrompt((p) => setQueue((q) => [...q, p])), [])
  const p = queue[0]
  useEffect(() => setValues((p?.fields ?? []).map(() => '')), [p?.requestId])
  if (!p) return null
  const answer = (a: string[] | null): void => {
    window.api.ssh.reply(p.requestId, a)
    setQueue((q) => q.slice(1))
  }
  const Icon = p.kind === 'confirm' ? ShieldAlert : p.kind === 'hostkey' ? ShieldQuestion : KeyRound
  return (
    <div className="palette-backdrop">
      <form
        className={`modal ${p.kind}`}
        onSubmit={(e) => {
          e.preventDefault()
          answer(p.kind === 'secret' ? values : ['yes'])
        }}
        onKeyDown={(e) => e.key === 'Escape' && answer(null)}
      >
        <div className="modal-head">
          <Icon size={18} />
          <strong>{p.title}</strong>
        </div>
        {p.message && <pre className="modal-msg">{p.message}</pre>}
        {p.fields?.map((f, i) => (
          <label key={i} className="field">
            <span>{f.label}</span>
            <input autoFocus={i === 0} type={f.secret ? 'password' : 'text'} value={values[i] ?? ''} onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))} />
          </label>
        ))}
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => answer(null)} autoFocus={p.kind !== 'secret'}>Cancel</button>
          <button type="submit" className={`btn ${p.kind === 'confirm' ? 'danger-solid' : 'primary'}`}>
            {p.kind === 'hostkey' ? 'Trust and connect' : p.kind === 'confirm' ? 'Connect anyway' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  )
}
