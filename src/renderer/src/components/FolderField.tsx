import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { basename, tildify } from '../lib/paths'
import { useStore } from '../state/store'
import { workspace } from '../state/workspace'

/**
 * A working-folder field: type a path or Browse… (native picker, opened at the current value), with
 * recent folders as one-click chips. Says when the path isn't an existing absolute folder.
 */
export function FolderField({ label = 'Working folder', value, onChange, hint, disabled }: { label?: string; value: string; onChange: (dir: string) => void; hint?: React.ReactNode; disabled?: boolean }): React.JSX.Element {
  const recent = useStore(workspace, (w) => w.recentFolders)
  const root = useStore(workspace, (w) => w.rootFolder)
  const [home, setHome] = useState('')
  const [valid, setValid] = useState(true)
  useEffect(() => void window.api.fs.home().then(setHome), [])
  useEffect(() => {
    let live = true
    const t = setTimeout(() => void window.api.fs.isDir(value).then((ok) => live && setValid(ok)), 250)
    return () => ((live = false), clearTimeout(t))
  }, [value])
  const browse = async (): Promise<void> => {
    const dir = await window.api.fs.pickFolder(value || root || undefined)
    if (dir) onChange(dir)
  }
  const chips = [...new Set([root, ...recent].filter((f): f is string => !!f && f !== value))].slice(0, 4)
  return (
    <div className="field">
      <span>{label}</span>
      <div className="path-input">
        <input className="mono" value={value} disabled={disabled} spellCheck={false} placeholder="e.g. ~/dev/my-app" aria-label={label} title={value} onChange={(e) => onChange(e.target.value.replace(/^~(?=[\\/]|$)/, home))} />
        <button type="button" className="btn icon" disabled={disabled} title="Browse…" aria-label="Browse for a folder" onClick={() => void browse()}>
          <FolderOpen size={13} />
        </button>
      </div>
      {!valid && value && <span className="field-hint tone-error">Not an existing folder. Use an absolute path, or Browse….</span>}
      {chips.length > 0 && !disabled && (
        <div className="launch-chips">
          {chips.map((f) => (
            <button key={f} type="button" className="launch-chip mono" title={f} onClick={() => onChange(f)}>
              {f === root ? `${basename(f)} (project)` : tildify(f, home)}
            </button>
          ))}
        </div>
      )}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}
