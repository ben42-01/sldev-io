import { useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { ExternalLink, RotateCw } from 'lucide-react'

/** Embedded browser for local dev servers (opened from a runtime's port chip). */
export function PreviewPanel(props: IDockviewPanelProps<{ url: string }>): React.JSX.Element {
  const [url, setUrl] = useState(props.params.url)
  const [draft, setDraft] = useState(props.params.url)
  const frame = useRef<HTMLIFrameElement>(null)
  const go = (u: string): void => {
    const full = /^https?:\/\//.test(u) ? u : `http://${u}`
    setUrl(full)
    setDraft(full)
    props.api.setTitle(full.replace(/^https?:\/\//, ''))
  }
  return (
    <div className="preview-panel">
      <form className="preview-bar" onSubmit={(e) => (e.preventDefault(), go(draft))}>
        <button type="button" className="icon-btn" title="Reload" onClick={() => frame.current && (frame.current.src = url)}>
          <RotateCw size={13} />
        </button>
        <input className="mono" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="button" className="icon-btn" title="Open in browser" onClick={() => void window.api.shell.openExternal(url)}>
          <ExternalLink size={13} />
        </button>
      </form>
      <iframe ref={frame} src={url} className="preview-frame" title="preview" />
    </div>
  )
}
