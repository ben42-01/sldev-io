// Writes an original soundtrack, public/music.mp3, arranged around the story in src/timeline.json
// (the same file the video reads, so a scene that grows or moves takes its music with it).
// Everything is synthesised here, so there's no licence to worry about; a produced track can still
// replace it (see README).
//
//   npm run music
//
// The sound: anti-aliased supersaws through a resonant filter, a layered kick that the rest of the
// mix pumps against (sidechain), a stereo reverb and a ping-pong delay, a hook that comes in when
// the agents start building, risers, snare fills and impacts into every chapter.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const timeline = require('../src/timeline.json')

const SR = 44100
const BPM = timeline.bpm
const BEAT = 60 / BPM
const BAR = BEAT * 4
const TOTAL_BARS = timeline.scenes.reduce((n, s) => n + s.bars, 0)
const N = Math.ceil((TOTAL_BARS * BAR + 4) * SR)

// ---------------------------------------------------------------- what each bar is

/** per bar: the scene's energy, the bar's index in its scene, and whether a chapter starts there */
const BARS = []
for (const s of timeline.scenes) for (let i = 0; i < s.bars; i++) BARS.push({ energy: s.energy, i, len: s.bars, id: s.id, chapter: i === 0 && !!s.chapter })
const DROP = 7 // the logo, inside the intro (src/scenes/Intro.tsx)

// ---------------------------------------------------------------- buses

const bus = () => [new Float32Array(N), new Float32Array(N)]
const DRUMS = bus()
const MUSIC = bus() // ducked by the kick
const VERB = bus() // reverb send
const ECHO = bus() // delay send
const duck = new Float32Array(N).fill(1)

const put = (b, i, l, r) => {
  if (i >= 0 && i < N) {
    b[0][i] += l
    b[1][i] += r
  }
}

let seed = 7
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
const midi = (m) => 440 * 2 ** ((m - 69) / 12)

/** a band-limited saw (polyBLEP), phase 0..1 */
function blepSaw(t, dt) {
  let v = 2 * t - 1
  if (t < dt) {
    const x = t / dt
    v -= x + x - x * x - 1
  } else if (t > 1 - dt) {
    const x = (t - 1) / dt
    v -= x * x + x + x + 1
  }
  return v
}

/** a TPT state-variable filter; set(cutoff, q) then tick(x) → { lp, bp, hp } */
function svf() {
  let ic1 = 0
  let ic2 = 0
  let a1 = 0
  let a2 = 0
  let a3 = 0
  let k = 1
  const o = { lp: 0, bp: 0, hp: 0 }
  return {
    set(fc, q = 0.707) {
      const g = Math.tan((Math.PI * Math.min(fc, SR * 0.45)) / SR)
      k = 1 / q
      a1 = 1 / (1 + g * (g + k))
      a2 = g * a1
      a3 = g * a2
    },
    tick(x) {
      const v3 = x - ic2
      const v1 = a1 * ic1 + a2 * v3
      const v2 = ic2 + a2 * ic1 + a3 * v3
      ic1 = 2 * v1 - ic1
      ic2 = 2 * v2 - ic2
      o.lp = v2
      o.bp = v1
      o.hp = x - k * v1 - v2
      return o
    }
  }
}

// ---------------------------------------------------------------- drums

const KICKS = []
function kick(t, gain = 1, duckDepth = 0.75) {
  const s = Math.floor(t * SR)
  let ph = 0
  for (let i = 0; i < 0.45 * SR; i++) {
    const x = i / SR
    ph += (2 * Math.PI * (46 + 150 * Math.exp(-x * 32))) / SR
    const body = Math.sin(ph) * Math.exp(-x * 6.5)
    const click = x < 0.004 ? noise() * (1 - x / 0.004) * 0.5 : 0
    const v = Math.tanh((body + click) * 1.8) * 0.72 * gain
    put(DRUMS, s + i, v, v)
  }
  KICKS.push([t, duckDepth])
}

function clap(t, gain = 1, verb = 0.35) {
  const s = Math.floor(t * SR)
  const f = svf()
  f.set(1300, 1.1)
  for (let i = 0; i < 0.3 * SR; i++) {
    const x = i / SR
    // three quick hands, then the tail
    const burst = [0, 0.011, 0.023].reduce((a, o) => a + (x >= o ? Math.exp(-(x - o) * 180) : 0), 0)
    const env = burst * 0.6 + Math.exp(-x * 16) * 0.55
    const v = f.tick(noise()).bp * env * 0.9 * gain
    put(DRUMS, s + i, v * 0.95, v)
    put(VERB, s + i, v * verb, v * verb)
  }
}

function hat(t, gain = 1, open = false, pan = 0.15) {
  const s = Math.floor(t * SR)
  const f = svf()
  f.set(open ? 7000 : 8500, 0.8)
  const len = open ? 0.28 : 0.06
  for (let i = 0; i < len * SR; i++) {
    const env = Math.exp(-(i / SR) * (open ? 11 : 75))
    const v = f.tick(noise()).hp * env * 0.16 * gain
    put(DRUMS, s + i, v * (1 - pan), v * (1 + pan))
    if (open) put(VERB, s + i, v * 0.2, v * 0.2)
  }
}

function crash(t, gain = 1) {
  const s = Math.floor(t * SR)
  const f = svf()
  f.set(5000, 0.6)
  for (let i = 0; i < 2.4 * SR; i++) {
    const env = Math.exp(-(i / SR) * 1.9)
    const l = f.tick(noise()).hp * env * 0.13 * gain
    const r = noise() * env * 0.05 * gain
    put(DRUMS, s + i, l + r, l - r)
    put(VERB, s + i, l * 0.3, l * 0.3)
  }
}

/** a boom and a wash for chapter downbeats */
function impact(t, gain = 1) {
  kick(t, 1.2 * gain, 0.9)
  crash(t, 1.3 * gain)
  const s = Math.floor(t * SR)
  let ph = 0
  for (let i = 0; i < 1.8 * SR; i++) {
    const x = i / SR
    ph += (2 * Math.PI * (30 + 50 * Math.exp(-x * 3))) / SR
    const v = Math.sin(ph) * Math.exp(-x * 2.2) * 0.5 * gain
    put(DRUMS, s + i, v, v)
  }
  // a short downlifter after the hit
  const f = svf()
  for (let i = 0; i < 1.2 * SR; i++) {
    const p = i / (1.2 * SR)
    if (i % 32 === 0) f.set(9000 * (1 - p) ** 2 + 200, 2)
    const v = f.tick(noise()).bp * (1 - p) * 0.12 * gain
    put(VERB, s + i, v, v)
    put(DRUMS, s + i, v * 0.5, v * 0.5)
  }
}

function riser(t0, t1, gain = 1) {
  const s = Math.floor(t0 * SR)
  const len = Math.floor((t1 - t0) * SR)
  const f = svf()
  let ph = 0
  for (let i = 0; i < len; i++) {
    const p = i / len
    if (i % 32 === 0) f.set(250 + 9000 * p * p, 3)
    ph += midi(57 + 24 * p * p) / SR
    const tone = blepSaw(ph % 1, midi(57 + 24 * p * p) / SR) * 0.15 * p
    const v = (f.tick(noise()).bp * 0.6 + tone) * p * p * 0.35 * gain
    put(MUSIC, s + i, v * (1 - p * 0.5), v * (1 + p * 0.5) * 0.9)
    put(VERB, s + i, v * 0.3, v * 0.3)
  }
}

function roll(t0, beatsLong, gain = 1) {
  const steps = beatsLong * 4
  for (let k = 0; k < steps; k++) {
    const sub = k >= steps - 4 ? 2 : 1
    for (let j = 0; j < sub; j++) clap(t0 + ((k + j / sub) * BEAT) / 4, (0.35 + (0.65 * k) / steps) * gain, 0.2)
  }
}

// ---------------------------------------------------------------- tonal parts

const PROG_A = [
  { root: 45, notes: [57, 60, 64, 67] }, // Am7
  { root: 41, notes: [53, 57, 60, 64] }, // Fmaj7
  { root: 48, notes: [52, 55, 60, 64] }, // C
  { root: 43, notes: [55, 59, 62, 67] } // G
]
const PROG_B = [
  { root: 41, notes: [53, 57, 60, 64] }, // Fmaj7
  { root: 43, notes: [55, 59, 62, 67] }, // G
  { root: 40, notes: [52, 55, 59, 64] }, // Em
  { root: 45, notes: [57, 60, 64, 69] } // Am
]

/** a detuned supersaw voice, filtered with an envelope */
function supersaw(t, dur, notes, { gain = 0.1, cutoff = 2000, cutoffEnd, q = 0.9, attack = 0.01, release = 0.08, voices = 7, spread = 0.18, verb = 0.25, echo = 0 } = {}) {
  const s = Math.floor(t * SR)
  const len = Math.floor((dur + release) * SR)
  const oscs = []
  notes.forEach((m) => {
    for (let v = 0; v < voices; v++) {
      const det = voices === 1 ? 0 : (v / (voices - 1) - 0.5) * 2 * spread
      const f = midi(m) * 2 ** (det / 12)
      oscs.push({ f, ph: ((v * 0.618 + m * 0.137) % 1), pan: voices === 1 ? 0 : (v / (voices - 1) - 0.5) * 1.6 })
    }
  })
  const fl = svf()
  const fr = svf()
  const norm = 1 / Math.sqrt(oscs.length)
  for (let i = 0; i < len; i++) {
    const x = i / SR
    if (i % 16 === 0) {
      const c = cutoffEnd === undefined ? cutoff : cutoff + (cutoffEnd - cutoff) * Math.min(1, x / dur)
      fl.set(c, q)
      fr.set(c, q)
    }
    let l = 0
    let r = 0
    for (const o of oscs) {
      const dt = o.f / SR
      o.ph += dt
      if (o.ph >= 1) o.ph -= 1
      const v = blepSaw(o.ph, dt)
      l += v * (1 - o.pan) * 0.5
      r += v * (1 + o.pan) * 0.5
    }
    const env = Math.min(1, x / attack) * (x > dur ? Math.max(0, 1 - (x - dur) / release) : 1)
    const L = fl.tick(l * norm).lp * env * gain
    const R = fr.tick(r * norm).lp * env * gain
    put(MUSIC, s + i, L, R)
    if (verb) put(VERB, s + i, L * verb, R * verb)
    if (echo) put(ECHO, s + i, L * echo, R * echo)
  }
}

function pluck(t, note, { gain = 0.1, bright = 3500, pan = 0, echo = 0.3, verb = 0.2 } = {}) {
  const s = Math.floor(t * SR)
  const f = svf()
  let ph = 0
  const fr = midi(note)
  for (let i = 0; i < 0.35 * SR; i++) {
    const x = i / SR
    if (i % 16 === 0) f.set(300 + bright * Math.exp(-x * 22), 1.4)
    ph = (ph + fr / SR) % 1
    const v = f.tick(blepSaw(ph, fr / SR)).lp * Math.exp(-x * 9) * Math.min(1, x * 600) * gain
    put(MUSIC, s + i, v * (1 - pan), v * (1 + pan))
    put(ECHO, s + i, v * echo, v * echo)
    put(VERB, s + i, v * verb, v * verb)
  }
}

function bass(t, dur, note, { gain = 0.35, cutoff = 600, decay = 10 } = {}) {
  const s = Math.floor(t * SR)
  const f = svf()
  let ph = 0
  let sub = 0
  const fr = midi(note)
  for (let i = 0; i < dur * SR; i++) {
    const x = i / SR
    if (i % 16 === 0) f.set(120 + cutoff * Math.exp(-x * decay), 1.2)
    ph = (ph + fr / SR) % 1
    sub += (2 * Math.PI * fr) / SR
    const env = Math.min(1, x * 400) * Math.min(1, (dur - x) * 300)
    const v = (f.tick(blepSaw(ph, fr / SR)).lp * 0.75 + Math.sin(sub) * 0.45) * env * gain
    put(MUSIC, s + i, v, v)
  }
}

// the hook, in eighths over four bars (null rests); it fits PROG_A
const HOOK = [
  [76, null, 76, 74, 72, null, 74, 76],
  [77, null, 76, null, 72, null, 69, null],
  [79, null, 76, null, 72, 74, 76, null],
  [74, null, 71, null, 67, null, 69, 71]
]
function hookBar(t, barInPhrase, { octave = 0, gain = 0.07 } = {}) {
  const line = HOOK[barInPhrase % 4]
  line.forEach((m, k) => {
    if (m === null) return
    let len = 1
    while (k + len < 8 && line[k + len] === null) len++
    supersaw(t + (k * BEAT) / 2, (len * BEAT) / 2 - 0.03, [m + octave], { gain, cutoff: 5200, cutoffEnd: 2600, q: 1.1, voices: 5, spread: 0.14, release: 0.12, verb: 0.3, echo: 0.28 })
  })
}

// ---------------------------------------------------------------- the arrangement

const ARP = [0, 1, 2, 3, 2, 1, 2, 3]
function arpBar(t, chord, { gain = 0.07, bright = 3500, up = 12 } = {}) {
  for (let k = 0; k < 16; k++) {
    const n = chord.notes[ARP[k % 8]] + up + (k % 8 >= 6 ? 12 : 0)
    pluck(t + (k * BEAT) / 4, n, { gain, bright, pan: k % 2 ? 0.4 : -0.4 })
  }
}

function gallop(t, chord, { gain = 0.33, cutoff = 700 } = {}) {
  for (let b = 0; b < 4; b++)
    for (const k of [1, 2, 3]) bass(t + b * BEAT + (k * BEAT) / 4, BEAT / 4 - 0.01, chord.root - 12, { gain: gain * (k === 2 ? 1 : 0.8), cutoff })
}

BARS.forEach((b, bar) => {
  const t = bar * BAR
  const next = BARS[bar + 1]
  const lite = b.energy === 'lite'
  const prog = lite ? PROG_B : PROG_A
  const chord = prog[bar % 4]
  const lastOfScene = b.i === b.len - 1

  if (b.chapter) impact(t, 1)
  else if (b.i === 0 && bar > 0 && b.energy !== 'intro') crash(t, 0.6)

  // into a chapter: a snare fill and a riser over the bar before it
  if (next && next.chapter) {
    roll(t + 2 * BEAT, 2, 0.85)
    riser(t, t + BAR - 0.05, 0.8)
  }

  if (b.energy === 'intro') {
    if (bar < 5) {
      // the chaos: dark pad, a pluck that opens up, then the kick and the bass come in
      supersaw(t, BAR, chord.notes.map((n) => n - 12), { gain: 0.07, cutoff: 400 + bar * 260, attack: 0.3, release: 0.4, verb: 0.4 })
      arpBar(t, chord, { gain: 0.045 + bar * 0.008, bright: 600 + bar * 700 })
      for (let k = 0; k < 4; k++) {
        if (bar >= 1) hat(t + k * BEAT + BEAT / 2, 0.5 + bar * 0.1)
        if (bar >= 2) kick(t + k * BEAT, 0.8, 0.5)
        if (bar >= 3 && (k === 1 || k === 3)) clap(t + k * BEAT, 0.8)
        if (bar >= 4) {
          hat(t + k * BEAT + BEAT / 4, 0.35)
          hat(t + k * BEAT + (3 * BEAT) / 4, 0.35)
        }
      }
      if (bar >= 2) gallop(t, chord, { gain: 0.26, cutoff: 200 + (bar - 2) * 300 })
      if (bar === 4) riser(t, t + BAR, 0.7)
    } else if (bar < DROP) {
      // the turn: everything drops out but the pad, the hook on a soft pluck, then a roll into the drop
      if (bar === 5) crash(t, 0.8)
      supersaw(t, BAR, chord.notes, { gain: 0.09, cutoff: 900 + (bar - 5) * 900, attack: 0.15, release: 0.5, verb: 0.55 })
      HOOK[bar % 4].forEach((m, k) => m !== null && pluck(t + (k * BEAT) / 2, m, { gain: 0.08, bright: 2400, echo: 0.4, verb: 0.4 }))
      if (bar === 6) {
        roll(t + 2 * BEAT, 2, 0.9)
        riser(t, t + BAR - 0.06, 1.1)
      }
    } else {
      // the drop: the logo
      if (bar === DROP) impact(t, 1.2)
      fullBar(t, chord, bar, { lead: false })
    }
    return
  }

  if (b.energy === 'groove') fullBar(t, chord, bar, { lead: false, sixteenths: false })
  if (b.energy === 'full') fullBar(t, chord, bar, { lead: true })
  if (b.energy === 'peak') fullBar(t, chord, bar, { lead: true, octave: 12, open: true })
  if (lite) liteBar(t, chord)
  if (b.energy === 'break') {
    // a breath before the close: pad and arp, no kick, a roll into the call to action
    supersaw(t, BAR, chord.notes, { gain: 0.15, cutoff: 1400 + b.i * 600, attack: 0.1, release: 0.4, verb: 0.5 })
    arpBar(t, chord, { gain: 0.1, bright: 2500 })
    hookBar(t, bar, { gain: 0.05 })
    for (let k = 0; k < 4; k++) hat(t + k * BEAT + BEAT / 2, 0.5)
    if (lastOfScene) {
      roll(t + 2 * BEAT, 2, 1)
      riser(t, t + BAR - 0.05, 1)
    }
  }
  if (b.energy === 'outro') {
    // full until three bars from the end, then the final hit and the tonic ringing out
    const hit = b.len - 3
    if (b.i < hit) fullBar(t, chord, bar, { lead: b.i < hit - 1, sixteenths: true })
    if (b.i === hit) {
      // the final hit, and the tonic ringing out
      impact(t, 1.2)
      supersaw(t, BAR * 2 - 0.4, PROG_A[0].notes, { gain: 0.11, cutoff: 2600, cutoffEnd: 700, attack: 0.01, release: 1.2, verb: 0.7 })
      bass(t, 1.6, PROG_A[0].root - 12, { gain: 0.35, cutoff: 300, decay: 2 })
    }
    return
  }

})

function fullBar(t, chord, bar, { lead = true, octave = 0, sixteenths = true, open = false } = {}) {
  for (let k = 0; k < 4; k++) {
    kick(t + k * BEAT, 1, 0.75)
    if (k === 1 || k === 3) clap(t + k * BEAT, 1)
    hat(t + k * BEAT + BEAT / 2, 1, open && k % 2 === 1)
    if (sixteenths) {
      hat(t + k * BEAT + BEAT / 4, 0.4, false, -0.3)
      hat(t + k * BEAT + (3 * BEAT) / 4, 0.4, false, -0.3)
    }
  }
  gallop(t, chord)
  // chords as a pumping supersaw stab per beat, on the offbeat
  for (let k = 0; k < 4; k++) supersaw(t + k * BEAT + BEAT / 2, BEAT / 2 - 0.04, chord.notes, { gain: 0.075, cutoff: 3200, cutoffEnd: 1400, release: 0.1, verb: 0.3 })
  supersaw(t, BAR, chord.notes.map((n) => n - 12), { gain: 0.05, cutoff: 1500, attack: 0.05, release: 0.2, verb: 0.35 })
  arpBar(t, chord, { gain: 0.05, bright: 4200, up: 24 })
  if (lead) hookBar(t, bar, { octave, gain: octave ? 0.06 : 0.07 })
  if (bar % 4 === 0) crash(t, 0.35)
}

function liteBar(t, chord) {
  // half time: kick on 1 and the "and" of 2, clap on 3, long bass notes, the arp carries it
  kick(t, 1, 0.6)
  kick(t + 1.5 * BEAT, 0.8, 0.5)
  clap(t + 2 * BEAT, 1, 0.5)
  for (let k = 0; k < 8; k++) hat(t + (k * BEAT) / 2, k % 2 ? 0.8 : 0.4)
  bass(t, BEAT * 2 - 0.02, chord.root - 12, { gain: 0.3, cutoff: 400, decay: 3 })
  bass(t + 2 * BEAT, BEAT * 2 - 0.02, chord.root - 12, { gain: 0.26, cutoff: 400, decay: 3 })
  supersaw(t, BAR, chord.notes, { gain: 0.08, cutoff: 1800, attack: 0.08, release: 0.3, verb: 0.45 })
  arpBar(t, chord, { gain: 0.065, bright: 3000 })
}

// ---------------------------------------------------------------- effects and the mix

// the sidechain: every kick pulls the music down and lets it swell back
for (const [t, depth] of KICKS) {
  const s = Math.floor(t * SR)
  const len = Math.floor(0.22 * SR)
  for (let i = 0; i < len && s + i < N; i++) {
    const g = 1 - depth * (1 - (i / len) ** 1.6)
    duck[s + i] = Math.min(duck[s + i], g)
  }
}

// ping-pong delay, dotted eighth, darkened on each repeat
function delay(src, dst) {
  const d = Math.floor(BEAT * 0.75 * SR)
  const bl = new Float32Array(d)
  const br = new Float32Array(d)
  let lpL = 0
  let lpR = 0
  for (let i = 0; i < N; i++) {
    const j = i % d
    const outL = bl[j]
    const outR = br[j]
    lpL += 0.45 * (outR - lpL)
    lpR += 0.45 * (outL - lpR)
    bl[j] = src[0][i] + lpL * 0.42
    br[j] = lpR * 0.42
    dst[0][i] += outL * 0.6
    dst[1][i] += outR * 0.6
    VERB[0][i] += outL * 0.15
    VERB[1][i] += outR * 0.15
  }
}

// Freeverb: eight damped combs and four allpasses per side
function reverb(src, dst, { room = 0.86, damp = 0.35, wet = 0.9 } = {}) {
  const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
  const ALLS = [556, 441, 341, 225]
  for (let ch = 0; ch < 2; ch++) {
    const spread = ch ? 23 : 0
    const combs = COMBS.map((n) => ({ buf: new Float32Array(n + spread), i: 0, lp: 0 }))
    const alls = ALLS.map((n) => ({ buf: new Float32Array(n + spread), i: 0 }))
    const x = src[ch]
    const y = dst[ch]
    for (let i = 0; i < N; i++) {
      const input = x[i] * 0.015
      let out = 0
      for (const c of combs) {
        const v = c.buf[c.i]
        c.lp = v * (1 - damp) + c.lp * damp
        c.buf[c.i] = input + c.lp * room
        if (++c.i >= c.buf.length) c.i = 0
        out += v
      }
      for (const a of alls) {
        const v = a.buf[a.i]
        a.buf[a.i] = out + v * 0.5
        if (++a.i >= a.buf.length) a.i = 0
        out = v - out
      }
      y[i] += out * wet
    }
  }
}

const FX = bus()
delay(ECHO, FX)
reverb(VERB, FX)

const L = new Float32Array(N)
const R = new Float32Array(N)
let hpL = 0
let hpR = 0
let pl = 0
let pr = 0
for (let i = 0; i < N; i++) {
  const d = duck[i]
  // the synths sit up front: the drums alone would swallow them
  let l = DRUMS[0][i] + (MUSIC[0][i] * 2.1 + FX[0][i] * 1.6) * d
  let r = DRUMS[1][i] + (MUSIC[1][i] * 2.1 + FX[1][i] * 1.6) * d
  // a gentle high-pass at ~25 Hz keeps the sub clean
  hpL = 0.9965 * (hpL + l - pl)
  hpR = 0.9965 * (hpR + r - pr)
  pl = l
  pr = r
  L[i] = hpL
  R[i] = hpR
}

let peak = 0
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
const DRIVE = 1.7
const ceil = Math.tanh(DRIVE)
const pcm = Buffer.alloc(N * 4)
for (let i = 0; i < N; i++) {
  const l = (Math.tanh((L[i] / peak) * DRIVE) / ceil) * 0.93
  const r = (Math.tanh((R[i] / peak) * DRIVE) / ceil) * 0.93
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
fs.mkdirSync(pub, { recursive: true })
const wav = path.join(pub, 'music.wav')
fs.writeFileSync(wav, Buffer.concat([header, pcm]))
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-b:a', '320k', path.join(pub, 'music.mp3')])
fs.rmSync(wav)
console.log(`public/music.mp3: ${(N / SR).toFixed(1)} s, ${BPM} BPM, ${TOTAL_BARS} bars`)
