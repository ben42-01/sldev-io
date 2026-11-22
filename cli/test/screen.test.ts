import { describe, expect, it } from 'vitest'
import { createTerm, snapshot, type Term } from '../src/screen'

const write = (t: Term, data: string): Promise<void> => new Promise((r) => t.write(data, r))
const lines = (t: Term): string[] => {
  const b = t.buffer.active
  return Array.from({ length: t.rows }, (_, i) => b.getLine(b.baseY + i)?.translateToString(true) ?? '')
}

describe('snapshot', () => {
  it('redraws a full-screen agent drawn after a resize exactly, at the pane size', async () => {
    const pane = createTerm(120, 40)
    await write(pane, 'shell output\r\n'.repeat(50))
    pane.resize(90, 20)
    // an agent on the alternate screen, positioned by cursor moves, its cursor hidden and SGR mouse on
    await write(pane, '\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h\x1b[2J')
    for (let r = 1; r <= 20; r++) await write(pane, `\x1b[${r};${r * 2}H\x1b[3${r % 8}mrow ${r}\x1b[0m`)
    const snap = await snapshot(pane)
    expect([snap.cols, snap.rows]).toEqual([90, 20])
    const view = createTerm(snap.cols, snap.rows)
    await write(view, snap.data)
    expect(view.buffer.active.type).toBe('alternate')
    expect(lines(view)).toEqual(lines(pane))
    expect(snap.data).toContain('\x1b[?25l')
    expect(snap.data).toContain('\x1b[?1006h')
    expect(view.modes.mouseTrackingMode).toBe('vt200')
  })

  it('includes output still being parsed when it was asked', async () => {
    const pane = createTerm(40, 5)
    pane.write('late line')
    const view = createTerm(40, 5)
    await write(view, (await snapshot(pane)).data)
    expect(lines(view)[0]).toBe('late line')
  })
})
