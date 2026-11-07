import { useMemo, useState } from 'react'
import { Check, Copy, NotebookPen } from 'lucide-react'
import { buildRecap, RECAP_GROUPS, RECAP_RANGES, recapDuration, recapMarkdown, recapStart, type RecapRange } from '@shared/recap'
import { basename } from '../lib/paths'
import { getAgent } from '../state/agents'
import { missions } from '../state/missions'
import { bumpNotes } from '../state/notes'
import { createStore, useStore } from '../state/store'
import { workspace } from '../state/workspace'
import { Modal } from './Modal'
import { openNote } from './NotesView'
import { showContextMenu } from './ContextMenu'

const open = createStore<{ range: RecapRange | null }>({ range: null })

/** The recap dialog: what the agents did, as Markdown for a standup or a status update. */
export function openRecap(range: RecapRange = 'standup'): void {
  open.set({ range })
}

/** The Recap button's menu, under the button. */
export function showRecapMenu(e: React.MouseEvent<HTMLElement>): void {
  const r = e.currentTarget.getBoundingClientRect()
  showContextMenu(
    { clientX: r.left, clientY: r.bottom + 4, preventDefault: () => e.preventDefault() },
    [{ type: 'header', label: 'Recap of agent work' }, ...RECAP_RANGES.map((x) => ({ label: `${x.label} · ${x.hint.toLowerCase()}`, run: () => openRecap(x.id) }))]
  )
}

export function RecapHost(): React.JSX.Element | null {
  const range = useStore(open, (s) => s.range)
  if (!range) return null
  return <RecapDialog initial={range} onClose={() => open.set({ range: null })} />
}

function RecapDialog({ initial, onClose }: { initial: RecapRange; onClose: () => void }): React.JSX.Element {
  const [range, setRange] = useState(initial)
  const [summaries, setSummaries] = useState(true)
  const [copied, setCopied] = useState(false)
  const root = useStore(workspace, (w) => w.rootFolder)
  const list = useStore(missions, (s) => s.list)
  // the recap is taken when the dialog opens or the range changes, not on every status tick
  const [now] = useState(() => Date.now())
  const recap = useMemo(() => buildRecap(list.filter((m) => m.root === root), recapStart(range, now), now), [list, root, range, now])
  const project = root ? basename(root) : 'project'
  const markdown = recapMarkdown(recap, { project, range, summaries, agentName: (id) => getAgent(id).name })

  const copy = (): void => {
    void navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }
  const save = async (): Promise<void> => {
    const title = `${RECAP_RANGES.find((x) => x.id === range)!.label} ${new Date(now).toISOString().slice(0, 10)}`
    const path = await window.api.notes.create(root, title)
    // the recap's heading becomes the note's title
    await window.api.notes.write(path, markdown.replace(/^## /, '# '))
    bumpNotes()
    openNote({ path, title })
    onClose()
  }

  return (
    <Modal
      title="Recap"
      size="lg"
      onClose={onClose}
      footerNote="Made from your missions on this machine. Nothing is sent anywhere."
      footer={
        <>
          <button type="button" className="btn" disabled={!root} onClick={() => void save()} title="Save it as a project note">
            <NotebookPen size={13} /> Save as note
          </button>
          <button type="button" className="btn primary" onClick={copy} data-autofocus>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy Markdown'}
          </button>
        </>
      }
    >
      <div className="recap">
        <div className="recap-bar">
          <div className="seg sm" role="group" aria-label="Recap period">
            {RECAP_RANGES.map((x) => (
              <button key={x.id} type="button" className={range === x.id ? 'on' : ''} aria-pressed={range === x.id} title={x.hint} onClick={() => setRange(x.id)}>
                {x.label}
              </button>
            ))}
          </div>
          <span className="grow" />
          <label className="check">
            <input type="checkbox" checked={summaries} onChange={(e) => setSummaries(e.target.checked)} /> Report lines
          </label>
        </div>
        <div className="recap-tiles">
          {RECAP_GROUPS.map((g) => (
            <div key={g.id} className={`recap-tile${recap.counts[g.id] ? '' : ' none'}`} data-group={g.id}>
              <span className="recap-num">{recap.counts[g.id]}</span>
              <span className="recap-label" title={g.title}>{g.short}</span>
            </div>
          ))}
          <div className="recap-tile">
            <span className="recap-num">{recap.files ? <><span className="add">+{recap.insertions}</span> <span className="del">−{recap.deletions}</span></> : '0'}</span>
            <span className="recap-label">{recap.files} file{recap.files === 1 ? '' : 's'}</span>
          </div>
          <div className="recap-tile">
            <span className="recap-num">{recapDuration(recap.working)}</span>
            <span className="recap-label">Agent time</span>
          </div>
        </div>
        <pre className="recap-md" aria-label="Recap as Markdown">{markdown}</pre>
      </div>
    </Modal>
  )
}
