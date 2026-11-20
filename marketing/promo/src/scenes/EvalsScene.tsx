import { FlaskConical, Network, Trophy } from 'lucide-react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { BRAND, C, MONO, beats, pop, progress } from '../lib'
import { Camera, Headline, Scrim, Spotlight, Window, focus } from '../ui'

/** the scene's beats, stretched to the bars it has in src/timeline.json */
const bt = (n: number): number => beats(n * 1.22)

// Evals (src/shared/evals.ts): the same tasks from your own repo, each agent in its own worktree, the
// checks decide. The grid fills in attempt by attempt, the leaderboard follows, and the Lead routes
// work to whoever wins.

const OX = 180 + 56
const OY = 160 + 46

const AGENTS = ['Claude Code · opus', 'Codex · gpt-5', 'Gemini CLI', 'Cursor Agent']
const EVALS = ['Rate-limit /login', 'Flaky checkout test', 'Refund flow', 'Migrate auth to sessions', 'N+1 query in orders']
/** passes out of 2 attempts, [eval][agent] */
const PASSES = [
  [2, 2, 1, 2],
  [1, 2, 2, 1],
  [2, 2, 1, 2],
  [2, 1, 1, 0],
  [1, 2, 1, 2]
]
const TIMES = ['4m 10s', '3m 02s', '5m 40s', '3m 55s']
const DIFFS = ['84 lines', '61 lines', '120 lines', '97 lines']

const CELL_AT = (e: number, a: number): number => 10 + (e * 4 + a) * 3
const SORT_AT = bt(7.5)

export function EvalsScene() {
  const frame = useCurrentFrame()
  const win = pop(frame, 0, 18)
  const scores = AGENTS.map((_, a) => {
    let pass = 0
    let total = 0
    EVALS.forEach((_, e) => {
      if (frame >= CELL_AT(e, a)) {
        pass += PASSES[e][a]
        total += 2
      }
    })
    return { pass, total, final: EVALS.reduce((n, _, e) => n + PASSES[e][a], 0) }
  })
  const rank = AGENTS.map((_, a) => a).sort((x, y) => scores[y].final - scores[x].final || x - y)
  const sorted = pop(frame, SORT_AT, 14)
  const winner = rank[0]
  const crown = pop(frame, SORT_AT + 14)
  const route = pop(frame, bt(11))
  return (
    <AbsoluteFill>
      <Camera
        keys={[
          [0, { y: 60, z: 0.86, rx: 14, ry: -12 }],
          [bt(1.5), focus(OX + 740, OY + 250, 1.12)],
          [bt(6.5), focus(OX + 740, OY + 260, 1.12)],
          [bt(8.5), focus(OX + 620, OY + 620, 1.3, { ry: 4 })],
          [bt(13), focus(OX + 700, OY + 600, 1.24, { ry: -3 })],
          [bt(15.5), { z: 1 }]
        ]}
      >
        <div style={{ position: 'absolute', left: 180, top: 160, opacity: win }}>
          <Window width={1560} height={880} active={0} title="Mission Control · Evals">
            <div style={{ position: 'absolute', left: 24, right: 24, top: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
              <FlaskConical size={22} strokeWidth={1.5} color={C.green} />
              <div style={{ fontSize: 22, fontWeight: 700 }}>Evals</div>
              <div style={{ fontSize: 15, color: C.muted }}>5 tasks from acme-shop · 4 agents · 2 attempts each · own worktree per attempt</div>
            </div>
            {/* the grid */}
            <div style={{ position: 'absolute', left: 24, right: 24, top: 70, border: `1px solid ${C.border}` }}>
              <div style={{ display: 'grid', gridTemplateColumns: '320px repeat(4, 1fr)', padding: '10px 16px', fontSize: 12, letterSpacing: '0.08em', fontWeight: 700, color: C.muted, borderBottom: `1px solid ${C.border}` }}>
                <span>EVAL</span>
                {AGENTS.map((a) => (
                  <span key={a} style={{ textAlign: 'center' }}>{a.toUpperCase()}</span>
                ))}
              </div>
              {EVALS.map((e, ei) => (
                <div key={e} style={{ display: 'grid', gridTemplateColumns: '320px repeat(4, 1fr)', padding: '0 16px', height: 50, alignItems: 'center', borderBottom: ei < EVALS.length - 1 ? `1px solid ${C.border}` : undefined, fontSize: 17 }}>
                  <span>{e}</span>
                  {AGENTS.map((_, a) => {
                    const at = CELL_AT(ei, a)
                    const p = pop(frame, at)
                    const n = PASSES[ei][a]
                    const tone = n === 2 ? C.green : n === 1 ? C.amber : C.red
                    const lit = frame >= SORT_AT && a === winner
                    return (
                      <span key={a} style={{ display: 'flex', justifyContent: 'center' }}>
                        {frame >= at ? (
                          <span style={{ padding: '3px 14px', borderRadius: 99, border: `1px solid ${tone}`, color: tone, fontFamily: MONO, fontSize: 15, transform: `scale(${0.6 + 0.4 * p})`, opacity: p, boxShadow: lit ? `0 0 16px ${tone}55` : 'none' }}>
                            {n}/2
                          </span>
                        ) : (
                          <span style={{ width: 54, height: 3, background: C.border, overflow: 'hidden', alignSelf: 'center' }}>
                            <span style={{ display: 'block', height: '100%', width: '40%', background: C.blue, transform: `translateX(${((frame * 7 + a * 50 + ei * 30) % 350) - 100}%)` }} />
                          </span>
                        )}
                      </span>
                    )
                  })}
                </div>
              ))}
            </div>
            {/* the leaderboard */}
            <div style={{ position: 'absolute', left: 24, right: 24, top: 430, bottom: 24, border: `1px solid ${C.border}`, padding: '14px 16px', boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, letterSpacing: '0.08em', fontWeight: 700, color: C.muted }}>
                <Trophy size={15} /> LEADERBOARD · YOUR CODE, YOUR CHECKS
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '50px 330px 1fr 160px 160px', marginTop: 14, fontSize: 12, letterSpacing: '0.08em', fontWeight: 700, color: C.subtle }}>
                <span>#</span>
                <span>AGENT</span>
                <span>PASS RATE</span>
                <span>MEDIAN TIME</span>
                <span>MEDIAN DIFF</span>
              </div>
              <div style={{ position: 'relative', height: 4 * 64, marginTop: 6 }}>
                {AGENTS.map((agent, a) => {
                  const final = rank.indexOf(a)
                  const y = interpolate(sorted, [0, 1], [a, final]) * 64
                  const s = scores[a]
                  const rate = s.total ? s.pass / s.total : 0
                  const top = frame >= SORT_AT && a === winner
                  return (
                    <div key={agent} style={{ position: 'absolute', left: 0, right: 0, top: y, height: 56, display: 'grid', gridTemplateColumns: '50px 330px 1fr 160px 160px', alignItems: 'center', fontSize: 19, background: top ? `${C.green}0c` : 'transparent', border: `1px solid ${top ? `${C.green}55` : 'transparent'}`, boxShadow: top ? `0 0 ${30 * crown}px ${C.green}33` : 'none' }}>
                      <span style={{ color: C.muted, paddingLeft: 10 }}>{frame >= SORT_AT ? final + 1 : a + 1}</span>
                      <span style={{ fontWeight: top ? 700 : 500, display: 'flex', alignItems: 'center', gap: 10 }}>
                        {agent}
                        {top && <Trophy size={18} color={C.green} style={{ opacity: crown, transform: `scale(${crown})` }} />}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <span style={{ width: 360, height: 8, background: C.border }}>
                          <span style={{ display: 'block', height: '100%', width: `${rate * 100}%`, background: top ? BRAND : C.green, opacity: top ? 1 : 0.7 }} />
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 17 }}>{Math.round(rate * 100)}%</span>
                      </span>
                      <span style={{ color: C.muted, fontFamily: MONO, fontSize: 16, opacity: progress(frame, bt(5), 10) }}>{TIMES[a]}</span>
                      <span style={{ color: C.muted, fontFamily: MONO, fontSize: 16, opacity: progress(frame, bt(5), 10) }}>{DIFFS[a]}</span>
                    </div>
                  )
                })}
              </div>
              <div style={{ position: 'absolute', right: 16, bottom: 14, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: `1px solid ${C.purple}88`, background: `${C.purple}10`, fontSize: 16, opacity: route, transform: `translateY(${(1 - route) * 20}px)` }}>
                <Network size={17} color={C.purple} /> Lead missions on <span style={{ fontFamily: MONO }}>auto</span> now send work to <b>{AGENTS[winner].split(' · ')[0]}</b>
              </div>
            </div>
            <Spotlight x={40} y={516} w={1424} h={58} at={SORT_AT + 16} out={bt(13)} tone={C.green} label="Measured on your repo, with your checks" />
          </Window>
        </div>
      </Camera>
      <Scrim />
      <Headline at={0} out={bt(7.6)}>{'Which agent is best on *your* code?'}</Headline>
      <Headline at={bt(8)}>{'Your tasks, your checks. *Not a benchmark.*'}</Headline>
    </AbsoluteFill>
  )
}
