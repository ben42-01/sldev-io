import { useEffect, useState } from 'react'
import { ago } from './MissionCard'

/** "5m ago" as a real <time>, with the absolute time on hover; re-renders while it's on screen. */
export function TimeAgo({ t, className = 'muted small' }: { t: number; className?: string }): React.JSX.Element {
  const [, tick] = useState(0)
  useEffect(() => {
    // under a minute the label changes every few seconds' worth of meaning; after that, every minute
    const every = Date.now() - t < 60_000 ? 10_000 : 60_000
    const timer = setInterval(() => tick((n) => n + 1), every)
    return () => clearInterval(timer)
  }, [t])
  const d = new Date(t)
  return (
    <time className={className} dateTime={d.toISOString()} title={d.toLocaleString()}>
      {ago(t)}
    </time>
  )
}
