import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { EditorView, basicSetup } from 'codemirror'
import { Compartment } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { Columns2, Eye, Factory, Pencil, Rocket, SendHorizontal } from 'lucide-react'
import { factoryFromNote, missionFromNote, sendNoteToTerminal } from '../components/NotesView'
import { bumpNotes } from '../state/notes'
import { appearance } from '../lib/theme'

const base = {
  '&': { height: '100%', backgroundColor: 'var(--bg)', fontSize: '13.5px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '16px 0', maxWidth: '860px' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', border: 'none', color: 'var(--fg-subtle)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--tint)' },
  '&.cm-focused': { outline: 'none' }
}
// oneDark brings the dark syntax colours; the light theme keeps CodeMirror's default (light) highlighting
const darkTheme = [EditorView.theme(base, { dark: true }), oneDark]
const lightTheme = [EditorView.theme(base, { dark: false })]
const themeFor = (t: 'dark' | 'light'): typeof darkTheme | typeof lightTheme => (t === 'light' ? lightTheme : darkTheme)

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
    const themeSlot = new Compartment()
    const stopTheme = appearance.subscribe(() => view.current?.dispatch({ effects: themeSlot.reconfigure(themeFor(appearance.get().theme)) }))
    void window.api.notes.read(path).then(
      (doc) => {
        setText(doc)
        view.current = new EditorView({
          doc,
          parent: host.current!,
          extensions: [
            basicSetup,
            markdown({ codeLanguages: languages }),
            themeSlot.of(themeFor(appearance.get().theme)),
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
      stopTheme()
      view.current?.destroy()
      view.current = null
    }
  }, [path]) // eslint-disable-line react-hooks/exhaustive-deps

  const html = mode !== 'edit' && text !== null ? DOMPurify.sanitize(marked.parse(text, { async: false }) as string) : ''

  return (
    <div className="note-panel">
      <div className="note-toolbar">
        <div className="note-send" role="group" aria-label="Send this note to">
          <span className="note-send-label">Send to</span>
          <button className="btn sm" title="Paste this note into the active terminal" aria-label="Send to the active terminal" onClick={() => void sendNoteToTerminal(path)}>
            <SendHorizontal size={12} /> <span className="btn-text">Terminal</span>
          </button>
          <button className="btn sm" title="Open the New mission form with this note as the brief: choose agent, model, effort and mode there" aria-label="Send to a new mission" onClick={() => void missionFromNote(path, props.api.title ?? 'Note')}>
            <Rocket size={12} /> <span className="btn-text">Mission…</span>
          </button>
          <button className="btn sm" title="Open the New factory run form with this note as what to build: choose the recipe and each stage's agent and model there" aria-label="Send to a new factory run" onClick={() => void factoryFromNote(path, props.api.title ?? 'Note')}>
            <Factory size={12} /> <span className="btn-text">Factory…</span>
          </button>
        </div>
        <span className="spacer" />
        <span className={`save-dot${saved ? '' : ' dirty'}`} title={saved ? 'Saved' : 'Saving…'} />
        <span className="muted small note-saved">{saved ? 'Saved' : 'Editing'}</span>
        <div className="seg sm">
          <button className={mode === 'edit' ? 'on' : ''} aria-pressed={mode === 'edit'} onClick={() => setMode('edit')} title="Edit" aria-label="Edit"><Pencil size={12} /></button>
          <button className={mode === 'split' ? 'on' : ''} aria-pressed={mode === 'split'} onClick={() => setMode('split')} title="Split" aria-label="Split"><Columns2 size={12} /></button>
          <button className={mode === 'preview' ? 'on' : ''} aria-pressed={mode === 'preview'} onClick={() => setMode('preview')} title="Preview" aria-label="Preview"><Eye size={12} /></button>
        </div>
      </div>
      {error && <div className="form-error pad">{error}</div>}
      <div className={`note-body ${mode}`}>
        <div className="note-editor" ref={host} />
        {mode !== 'edit' && <div className="note-preview markdown" dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
    </div>
  )
}
