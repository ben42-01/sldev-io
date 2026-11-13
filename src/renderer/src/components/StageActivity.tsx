import { useEffect, useState } from 'react'
import { getAgent } from '../state/agents'
import { terminalTail } from '../lib/terminals'
import { isLive, missions, useMission } from '../state/missions'

/**
 * What a running agent stage is doing right now. Print mode shows nothing in the terminal until the
 * agent exits, so without this a long stage looks stuck. Hook agents report each tool call; for the
 * others the terminal's last line is the best there is.
 */
export function StageActivity({ missionId, className = 'pn-activity' }: { missionId: string; className?: string }): React.JSX.Element | null {
  const m = useMission(missionId)
  // re-render every few seconds so the time moves; the time itself is read at render
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000)
    return () => clearInterval(t)
  }, [])
  if (!m || !isLive(m.status)) return null
  const hooks = getAgent(m.options.agent).hooks
  const panel = missions.get().panels[missionId]
  const text = hooks ? m.activity : panel ? terminalTail(panel, 20).split('\n').filter((l) => l.trim()).pop()?.trim() : undefined
  const at = m.activityAt
  // a hook agent's time is how long the current step has run; for the others, how long since any output
  const since = at ? duration(Math.max(0, Date.now() - at)) : ''
  const when = since && (hooks ? `for ${since}` : `${since} ago`)
  if (!text && !when) return null
  return (
    <div className={className} title={text}>
      {text ?? 'working'}
      {when && <span className="pn-activity-when"> · {when}</span>}
    </div>
  )
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
