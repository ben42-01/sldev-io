// Writes an original placeholder soundtrack, public/music.mp3: 44 bars at 120 BPM in A minor,
// arranged around the story in src/Promo.tsx. Made from scratch here, so there's no licence to
// worry about; replace it with a produced track whenever you have one (see README).
//
//   npm run music
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const SR = 44100
const BPM = 120
const BEAT = 60 / BPM
const BAR = BEAT * 4
const BARS = 44
const N = Math.ceil((BARS * BAR + 2) * SR)
const L = new Float32Array(N)
const R = new Float32Array(N)

// scene boundaries in bars (src/Promo.tsx): chaos 0, turn 5, logo 7, missions 9, review 17,
// factory 22, failover 30, agents 35, cta 40
const DROP = 7
const END = 43

let seed = 1
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
const midi = (m) => 440 * 2 ** ((m - 69) / 12)
const add = (i, l, r = l) => {
  if (i >= 0 && i < N) {
    L[i] += l
    R[i] += r
  }
}

// i – VI – III – VII: Am F C G
const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [48, 52, 55],
  [55, 59, 62]
]
const chordAt = (bar) => CHORDS[bar % 4]

function kick(t, gain = 1) {
  const s = Math.floor(t * SR)
  let ph = 0
  for (let i = 0; i < 0.35 * SR; i++) {
    const x = i / SR
    ph += (2 * Math.PI * (48 + 110 * Math.exp(-x * 28))) / SR
    add(s + i, Math.sin(ph) * Math.exp(-x * 9) * 0.9 * gain)
  }
}

function clap(t, gain = 1) {
  const s = Math.floor(t * SR)
  let lp = 0
  for (let i = 0; i < 0.22 * SR; i++) {
    const x = i / SR
    const n = noise()
    lp += 0.35 * (n - lp)
    const env = Math.exp(-x * 22) * (x < 0.01 ? 0.6 : 1)
    add(s + i, (n - lp) * env * 0.32 * gain, (n - lp) * env * 0.28 * gain)
  }
}

function hat(t, gain = 1, open = false) {
  const s = Math.floor(t * SR)
  let prev = 0
  const len = open ? 0.18 : 0.045
  for (let i = 0; i < len * SR; i++) {
    const n = noise()
    const hp = n - prev
    prev = n
    const env = Math.exp(-(i / SR) * (open ? 18 : 70))
    add(s + i, hp * env * 0.09 * gain * 0.8, hp * env * 0.09 * gain)
  }
}

// a filtered saw, for bass and the pluck lead
function saw(t, dur, freq, { gain = 0.2, cutoff = 800, decay = 6, pan = 0 } = {}) {
  const s = Math.floor(t * SR)
  let lp = 0
  for (let i = 0; i < dur * SR; i++) {
    const x = i / SR
    const v = 2 * ((x * freq) % 1) - 1
    const env = Math.exp(-x * decay) * Math.min(1, x * 400)
    const a = Math.min(0.99, (2 * Math.PI * cutoff * (0.3 + 0.7 * Math.exp(-x * 8))) / SR)
    lp += a * (v - lp)
    add(s + i, lp * env * gain * (1 - pan), lp * env * gain * (1 + pan))
  }
}

// a soft detuned pad for a whole bar
function pad(t, notes, gain, cutoff) {
  const s = Math.floor(t * SR)
  const len = BAR * SR
  const lps = notes.map(() => [0, 0])
  for (let i = 0; i < len; i++) {
    const x = i / SR
    const env = Math.min(1, x * 6) * Math.min(1, (BAR - x) * 8)
    let l = 0
    let r = 0
    notes.forEach((m, k) => {
      const f = midi(m + 12)
      const a = (2 * Math.PI * cutoff) / SR
      const v1 = 2 * ((x * f * 1.003) % 1) - 1
      const v2 = 2 * ((x * f * 0.997) % 1) - 1
      lps[k][0] += a * (v1 - lps[k][0])
      lps[k][1] += a * (v2 - lps[k][1])
      l += lps[k][0]
      r += lps[k][1]
    })
    add(s + i, (l / notes.length) * env * gain, (r / notes.length) * env * gain)
  }
}

// rising filtered noise into a drop
function riser(t0, t1, gain = 0.25) {
  const s = Math.floor(t0 * SR)
  const len = Math.floor((t1 - t0) * SR)
  let lp = 0
  for (let i = 0; i < len; i++) {
    const p = i / len
    const a = Math.min(0.99, (2 * Math.PI * (200 + 9000 * p * p)) / SR)
    lp += a * (noise() - lp)
    add(s + i, lp * p * p * gain)
  }
}

function crash(t, gain = 0.5) {
  const s = Math.floor(t * SR)
  let prev = 0
  for (let i = 0; i < 1.6 * SR; i++) {
    const n = noise()
    const hp = n - prev * 0.6
    prev = n
    const env = Math.exp(-(i / SR) * 2.4)
    add(s + i, hp * env * 0.12 * gain, noise() * env * 0.12 * gain)
  }
}

for (let bar = 0; bar < BARS; bar++) {
  const t = bar * BAR
  const chord = chordAt(bar)
  const full = bar >= DROP && bar < END
  const breakdown = bar >= 5 && bar < DROP

  // pad everywhere; darker in the intro, open from the drop
  pad(t, chord, full ? 0.22 : 0.24, full ? 2200 : breakdown ? 900 : 600 + bar * 200)

  for (let b = 0; b < 4; b++) {
    const tb = t + b * BEAT
    if (full || (bar >= 2 && bar < 5)) kick(tb, full ? 1 : 0.7)
    if (full && (b === 1 || b === 3)) clap(tb)
    // hats: offbeats in the intro, 16ths in the groove
    if (!breakdown || bar === 6) hat(tb + BEAT / 2, full ? 1 : 0.6, full && b === 3)
    if (full) {
      hat(tb + BEAT / 4, 0.45)
      hat(tb + (3 * BEAT) / 4, 0.45)
    }
    // bass on the offbeat 8ths, pumping against the kick
    if (full) {
      saw(tb + BEAT / 2, BEAT / 2, midi(chord[0] - 24), { gain: 0.32, cutoff: 500, decay: 5 })
      saw(tb + BEAT / 2, BEAT / 2, midi(chord[0] - 12), { gain: 0.08, cutoff: 900, decay: 8 })
    }
  }

  // pluck arpeggio: 16ths of the chord, from bar 1 quietly, louder in the groove
  if (!breakdown && bar < END) {
    const pattern = [0, 1, 2, 1, 0, 2, 1, 2]
    for (let k = 0; k < 16; k++) {
      const note = chord[pattern[k % 8]] + 12 + (k % 8 >= 6 ? 12 : 0)
      saw(t + (k * BEAT) / 4, BEAT / 2, midi(note), { gain: full ? 0.09 : 0.08, cutoff: full ? 3200 : 1800, decay: 14, pan: k % 2 ? 0.35 : -0.35 })
    }
  }

  // the turn: a snare roll into the drop
  if (bar === 6) {
    for (let k = 8; k < 16; k++) clap(t + (k * BEAT) / 4, 0.4 + (k - 8) * 0.08)
    for (let k = 0; k < 4; k++) clap(t + 3 * BEAT + (k * BEAT) / 8, 0.9)
  }
  if (bar === 4) riser(t, t + BAR, 0.18)
  if (bar === 6) riser(t, t + BAR, 0.3)
  // a crash on every scene change after the drop
  if ([DROP, 9, 17, 22, 30, 35, 40].includes(bar)) crash(t, bar === DROP ? 0.9 : 0.5)
}

// the last bar: one big hit and the chord ringing out
kick(END * BAR, 1.2)
crash(END * BAR, 1)
pad(END * BAR, chordAt(0), 0.2, 1600)

// a light pump on every beat in the groove, then a soft limiter
for (let i = 0; i < N; i++) {
  const x = i / SR
  const bar = x / BAR
  if (bar >= DROP && bar < END) {
    const p = (x % BEAT) / BEAT
    const duck = 0.55 + 0.45 * Math.min(1, p * 4)
    L[i] *= 0.8 + 0.2 * duck
    R[i] *= 0.8 + 0.2 * duck
  }
}
let peak = 0
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
const pcm = Buffer.alloc(N * 4)
for (let i = 0; i < N; i++) {
  const l = Math.tanh((L[i] / peak) * 1.4) * 0.92
  const r = Math.tanh((R[i] / peak) * 1.4) * 0.92
  pcm.writeInt16LE(Math.round(l * 32767), i * 4)
  pcm.writeInt16LE(Math.round(r * 32767), i * 4 + 2)
}
const header = Buffer.alloc(44)
header.write('RIFF', 0)
header.writeUInt32LE(36 + pcm.length, 4)
header.write('WAVEfmt ', 8)
header.writeUInt32LE(16, 16)
header.writeUInt16LE(1, 20)
header.writeUInt16LE(2, 22)
header.writeUInt32LE(SR, 24)
header.writeUInt32LE(SR * 4, 28)
header.writeUInt16LE(4, 32)
header.writeUInt16LE(16, 34)
header.write('data', 36)
header.writeUInt32LE(pcm.length, 40)

const pub = path.join(__dirname, '..', 'public')
const wav = path.join(pub, 'music.wav')
fs.writeFileSync(wav, Buffer.concat([header, pcm]))
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-b:a', '256k', path.join(pub, 'music.mp3')])
fs.rmSync(wav)
console.log(`public/music.mp3: ${(N / SR).toFixed(1)} s, ${BPM} BPM`)
