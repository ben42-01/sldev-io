import { missions } from './missions'

/** Windows has no badge count: draw a small numbered dot for the taskbar overlay instead. */
function overlay(count: number): string {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')!
  g.fillStyle = '#e5484d'
  g.beginPath()
  g.arc(16, 16, 16, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#fff'
  g.font = 'bold 20px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(count > 9 ? '9+' : String(count), 16, 17)
  return c.toDataURL()
}

/** Keeps the dock/taskbar badge at the number of missions that need you. */
export function initBadge(): void {
  let shown = 0
  const sync = (): void => {
    const count = missions.get().list.filter((m) => m.status === 'needs-input').length
    if (count === shown) return
    shown = count
    void window.api.app.badge(count, window.api.platform === 'win32' && count > 0 ? overlay(count) : null)
  }
  missions.subscribe(sync)
}
