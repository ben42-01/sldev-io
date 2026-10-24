import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { EditorView, basicSetup } from 'codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { Columns2, Eye, Pencil, Rocket, SendHorizontal } from 'lucide-react'
import { missionFromNote, sendNoteToTerminal } from '../components/NotesView'
import { bumpNotes } from '../state/notes'

const editorTheme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'var(--bg)', fontSize: '13.5px' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
    '.cm-content': { padding: '16px 0', maxWidth: '860px' },
    '.cm-gutters': { backgroundColor: 'var(--bg)', border: 'none', color: '#4a4a4a' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#ffffff06' },
    '&.cm-focused': { outline: 'none' }
  },
  { dark: true }
)

type Mode = 'edit' | 'split' | 'preview'

export function NotePanel(props: IDockviewPanelProps<{ path: string }>): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [saved, setSaved] = useState(true)
  const [mode, setMode] = useState<Mode>('edit')
  const [error, setError] = useState('')
  const path = props.params.path

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: string | null = null
    const flush = (): void => {
      if (pending === null) return
      const t = pending
      pending = null
      void window.api.notes.write(path, t).then(() => {
        setSaved(true)
        const title = /^#\s+(.+)$/m.exec(t)?.[1]?.trim()
        if (title) props.api.setTitle(title)
        bumpNotes()
      }, (e) => setError(String(e)))
    }
    void window.api.notes.read(path).then(
      (doc) => {
        setText(doc)
        view.current = new EditorView({
          doc,
          parent: host.current!,
          extensions: [
            basicSetup,
            markdown({ codeLanguages: languages }),
            editorTheme,
            oneDark,
            EditorView.lineWrapping,
            EditorView.updateListener.of((u) => {
              if (!u.docChanged) return
              const t = u.state.doc.toString()
              setText(t)
              setSaved(false)
              pending = t
              clearTimeout(timer)
              timer = setTimeout(flush, 600)
            })
          ]
        })
      },
      () => setError('This note no longer exists.')
    )
    const active = props.api.onDidActiveChange((e) => e.isActive && view.current?.focus())
    return () => {
      clearTimeout(timer)
      flush()
      active.dispose()
      view.current?.destroy()
      view.current = null
    }
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  const html = mode !== 'edit' && text !== null ? DOMPurify.sanitize(marked.parse(text, { async: false }) as string) : ''

  return (
    <div className="note-panel">
      <div className="note-toolbar">
        <span className={`save-dot${saved ? '' : ' dirty'}`} title={saved ? 'Saved' : 'Saving…'} />
        <span className="muted small">{saved ? 'Saved' : 'Editing'}</span>
        <span className="spacer" />
        <div className="seg sm">
          <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')} title="Edit"><Pencil size={12} /></button>
          <button className={mode === 'split' ? 'on' : ''} onClick={() => setMode('split')} title="Split"><Columns2 size={12} /></button>
          <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')} title="Preview"><Eye size={12} /></button>
        </div>
        <button className="btn sm" title="Paste this note into the active terminal" onClick={() => void sendNoteToTerminal(path)}><SendHorizontal size={12} /> To terminal</button>
        <button className="btn sm" title="Start an agent mission with this note as the prompt" onClick={() => void missionFromNote(path, props.api.title ?? 'Note')}><Rocket size={12} /> Mission</button>
      </div>
      {error && <div className="form-error pad">{error}</div>}
      <div className={`note-body ${mode}`}>
        <div className="note-editor" ref={host} />
        {mode !== 'edit' && <div className="note-preview markdown" dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
    </div>
  )
}
