import { useEffect, useState } from 'react'
import type { SshPrompt } from '@shared/types'
import { ShieldAlert, ShieldQuestion, KeyRound } from 'lucide-react'
import { Modal } from './Modal'

/** Questions the SSH layer asks: unknown/changed host keys, passwords, 2FA codes. */
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
    <Modal
      key={p.requestId}
      title={
        <>
          <Icon size={16} /> {p.title}
        </>
      }
      tone={p.kind === 'confirm' ? 'danger' : undefined}
      onClose={() => answer(null)}
      onSubmit={() => answer(p.kind === 'secret' ? values : ['yes'])}
      footerNote={p.kind === 'secret' ? 'Sent to the server only; never stored unless you save it in Credentials.' : undefined}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={() => answer(null)}>Cancel</button>
          <button type="submit" className={`btn ${p.kind === 'confirm' ? 'danger-solid' : 'primary'}`} data-autofocus={p.kind !== 'secret' || undefined}>
            {p.kind === 'hostkey' ? 'Trust and connect' : p.kind === 'confirm' ? 'Connect anyway' : 'Continue'}
          </button>
        </>
      }
    >
      {p.message && <pre className="modal-msg">{p.message}</pre>}
      {p.fields?.map((f, i) => (
        <label key={i} className="field">
          <span>{f.label}</span>
          <input className="input" type={f.secret ? 'password' : 'text'} spellCheck={false} value={values[i] ?? ''} onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))} />
        </label>
      ))}
    </Modal>
  )
}
