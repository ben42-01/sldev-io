let ctx: AudioContext | null = null

/** Two soft notes, synthesized so there's no audio file to ship. */
export function playChime(): void {
  ctx ??= new AudioContext()
  const now = ctx.currentTime
  for (const [i, freq] of [660, 880].entries()) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const start = now + i * 0.12
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3)
    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(start + 0.32)
  }
}
