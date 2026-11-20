import { useEffect, useRef, useState } from 'react'

/** Copies with the Clipboard API, or a hidden textarea where that isn't there (http, older browsers). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

/** A shell command in a code block; one click anywhere on it copies it. */
export function CopyCommand({ command, label }: { command: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  function copy(): void {
    void copyText(command).then((ok) => {
      setState(ok ? 'copied' : 'failed')
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setState('idle'), 1800)
    })
  }

  return (
    <button type="button" className="copy-cmd" onClick={copy} aria-label={`Copy ${label ?? 'command'}: ${command}`} title="Copy to clipboard">
      <span className="copy-cmd-prompt" aria-hidden="true">$</span>
      <code className="copy-cmd-text">{command}</code>
      <span className={`copy-cmd-state ${state}`} aria-live="polite">
        {state === 'copied' ? (
          <>
            <CheckIcon /> Copied
          </>
        ) : state === 'failed' ? (
          'Select and copy'
        ) : (
          <>
            <CopyIcon /> Copy
          </>
        )}
      </span>
    </button>
  )
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" />
      <path d="M5 15H3V3h12v2" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" aria-hidden="true">
      <path d="M4 12l5 5L20 6" />
    </svg>
  )
}
