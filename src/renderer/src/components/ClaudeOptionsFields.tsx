import type { ClaudeTaskOptions } from '@shared/types'

const MODELS = ['', 'opus', 'sonnet', 'haiku', 'fable']
const PERMISSION_MODES = ['', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'manual', 'bypassPermissions']
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max']

/** Model / effort / permission / print / extra-args fields shared by the task and mission forms. */
export function ClaudeOptionsFields({ value, onChange, showPrint = true }: { value: ClaudeTaskOptions; onChange: (p: Partial<ClaudeTaskOptions>) => void; showPrint?: boolean }): React.JSX.Element {
  return (
    <>
      <div className="field-row">
        <label className="field">
          <span>Model</span>
          <select value={value.model ?? ''} onChange={(e) => onChange({ model: e.target.value || undefined })}>
            {MODELS.map((m) => <option key={m} value={m}>{m || 'default'}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Effort</span>
          <select value={value.effort ?? ''} onChange={(e) => onChange({ effort: e.target.value || undefined })}>
            {EFFORTS.map((m) => <option key={m} value={m}>{m || 'default'}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Permission mode</span>
        <select value={value.permissionMode ?? ''} onChange={(e) => onChange({ permissionMode: e.target.value || undefined })}>
          {PERMISSION_MODES.map((m) => <option key={m} value={m}>{m || 'default'}</option>)}
        </select>
      </label>
      {showPrint && (
        <label className="check">
          <input type="checkbox" checked={!!value.print} onChange={(e) => onChange({ print: e.target.checked || undefined })} />
          <span>Non-interactive (print result and exit)</span>
        </label>
      )}
      <label className="field">
        <span>Extra arguments</span>
        <input className="mono" value={value.extraArgs ?? ''} placeholder="--add-dir ../shared" onChange={(e) => onChange({ extraArgs: e.target.value || undefined })} />
      </label>
    </>
  )
}
