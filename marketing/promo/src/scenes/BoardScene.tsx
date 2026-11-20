import { Check, GitPullRequest, Hourglass, KanbanSquare, Sparkles } from 'lucide-react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { C, MONO, beats, pop, progress } from '../lib'
import { Button, Camera, Headline, Pointer, Scrim, Spotlight, Toast, Window, focus, walk } from '../ui'

/** the scene's beats, stretched to the bars it has in src/timeline.json */
const bt = (n: number): number => beats(n * 1.15)

// The work board (src/shared/board.ts): an agent writes the stories, they land in Proposed, a person
// approves them, pick-up starts them as runs, and a merged PR moves the card to Done on its own.

const COLS = ['Backlog', 'Proposed', 'Agent ready', 'In progress', 'Review', 'Done']
const TONES = [C.subtle, C.purple, C.blue, C.blue, C.blue, C.green]
const COL_W = 232
const GAP = 12
const TOP = 96
const CARD_H = 128
const colX = (c: number): number => 24 + c * (COL_W + GAP)

/** the window's content origin on the stage: window at (180, 160), title bar 46, activity bar 56 */
const OX = 180 + 56
const OY = 160 + 46

interface Card {
  n?: number
  title: string
  labels: string[]
  agent?: string
  /** written by an agent */
  drafted?: boolean
  waits?: number
  pr?: number
  timeline: Array<[number, number]>
}

const CARDS: Card[] = [
  { n: 12, title: 'Invite people by email', labels: ['feature', 'api'], agent: 'Codex', drafted: true, pr: 142, timeline: [[bt(2.5), 1], [bt(7.6), 2], [bt(10), 3], [bt(14), 4], [bt(17.5), 5]] },
  { n: 13, title: 'Rate-limit the invite endpoint', labels: ['api'], agent: 'Claude Code', drafted: true, pr: 143, timeline: [[bt(3.1), 1], [bt(8), 2], [bt(10.5), 3], [bt(18.5), 4]] },
  { n: 14, title: 'Owners can remove a member', labels: ['auth'], agent: 'Gemini CLI', drafted: true, waits: 12, timeline: [[bt(3.7), 1], [bt(8.4), 2], [bt(18), 3]] },
  { title: 'Audit log export', labels: ['idea'], timeline: [[0, 0]] },
  { title: 'Dark mode for emails', labels: ['ui'], timeline: [[0, 0]] },
  { n: 9, title: 'Team settings page', labels: ['ui'], agent: 'Cursor Agent', pr: 131, timeline: [[0, 5]] }
]

const WRITE_AT = bt(1.2)
const APPROVE_AT = bt(7)
const MERGED_AT = bt(17)

export function BoardScene() {
  const frame = useCurrentFrame()
  const win = pop(frame, 0, 18)
  const spots = walk(
    CARDS.map((c) => c.timeline),
    frame,
    (col, row) => [colX(col) + 8, TOP + 48 + row * (CARD_H + 10)]
  )
  const count = (col: number): number => spots.filter((s) => s && s.col === col).length
  const proposedWaiting = count(1) > 0 && frame < APPROVE_AT + 6
  return (
    <AbsoluteFill>
      <Camera
        keys={[
          [0, { y: 120, z: 0.82, rx: 20, ry: -8 }],
          [bt(1.6), { z: 1 }],
          [bt(2.6), { z: 1 }],
          [bt(4.4), focus(OX + colX(1) + COL_W / 2 + 120, OY + 330, 1.32, { ry: 4 })],
          [bt(8.2), focus(OX + colX(1) + COL_W / 2 + 200, OY + 330, 1.32, { ry: 4 })],
          [bt(10.5), focus(OX + colX(3) + COL_W / 2, OY + 320, 1.28, { ry: -3 })],
          [bt(14.5), focus(OX + colX(3) + COL_W / 2 + 60, OY + 320, 1.28, { ry: -3 })],
          [bt(16.5), focus(OX + colX(4) + COL_W + 6, OY + 320, 1.34, { ry: -6 })],
          [bt(19.5), focus(OX + colX(4) + COL_W + 6, OY + 320, 1.34, { ry: -6 })],
          [bt(22), { z: 1, ry: 4 }]
        ]}
      >
        <div style={{ position: 'absolute', left: 180, top: 160, opacity: win }}>
          <Window width={1560} height={880} active={5} title="Board · acme-shop">
            <div style={{ position: 'absolute', left: 24, right: 24, top: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 44, height: 44, border: `1px solid ${C.borderStrong}`, display: 'grid', placeItems: 'center' }}>
                <KanbanSquare size={22} strokeWidth={1.5} />
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700 }}>Board</div>
                <div style={{ fontSize: 15, color: C.muted }}>acme-shop · {count(2)} agent ready · pick-up on</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', border: `1px solid ${C.green}66`, color: C.green, fontSize: 14, fontWeight: 600, boxShadow: frame > bt(9.6) && frame < bt(11) ? `0 0 24px ${C.green}55` : 'none' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: C.green }} /> Auto pick-up · 3 at a time
                </span>
                <Button primary glow={frame > WRITE_AT - 8 && frame < WRITE_AT + 8 ? 1 : 0}>
                  <Sparkles size={15} /> Write stories
                </Button>
              </div>
            </div>
            {COLS.map((label, i) => (
              <div key={label} style={{ position: 'absolute', left: colX(i), top: TOP, width: COL_W, bottom: 24, border: `1px solid ${C.border}`, background: '#0b0b0b' }}>
                <div style={{ padding: '11px 12px', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: C.muted, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: TONES[i] }} />
                  {label.toUpperCase()}
                  {i === 2 && <span style={{ fontSize: 10, padding: '1px 6px', border: `1px solid ${C.green}66`, color: C.green, borderRadius: 99 }}>AUTO</span>}
                  <span style={{ marginLeft: 'auto', color: C.subtle }}>{count(i)}</span>
                </div>
                {i === 1 && proposedWaiting && (
                  <div style={{ position: 'absolute', left: 8, right: 8, bottom: 10, opacity: progress(frame, bt(4.4), 10) }}>
                    <Button primary glow={frame > APPROVE_AT - 10 && frame < APPROVE_AT + 6 ? 1 : 0} style={{ width: '100%', justifyContent: 'center', boxSizing: 'border-box' }}>
                      <Check size={15} /> Approve all 3
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {CARDS.map((c, i) => {
              const s = spots[i]
              if (!s) return null
              return <CardView key={c.title} card={c} col={s.col} x={s.x} y={s.y} appear={s.appear} frame={frame} />
            })}
            <Spotlight x={colX(1)} y={TOP} w={COL_W} h={834 - TOP - 24} at={bt(4)} out={bt(7.4)} tone={C.purple} label="Written by an agent, waiting for you" />
            <Spotlight x={colX(5)} y={TOP} w={COL_W} h={330} at={bt(17.8)} out={bt(21.5)} tone={C.green} label="Moved by the merge" side="bottom" />
            <Toast at={MERGED_AT} out={bt(21)} tone={C.green} icon={<GitPullRequest size={20} />} title="PR #142 merged" text="Invite people by email → Done. #14 can start." />
            <Pointer
              path={[
                [0, 1200, 700],
                [bt(0.4), 1200, 700],
                [WRITE_AT - 4, 1400, 44],
                [bt(5.4), 1400, 44],
                [APPROVE_AT - 6, colX(1) + 116, 806],
                [bt(12), colX(1) + 116, 806],
                [bt(15), 1100, 740]
              ]}
              click={[WRITE_AT, APPROVE_AT]}
            />
          </Window>
        </div>
      </Camera>
      <Scrim />
      <Headline at={0} out={bt(6.6)}>{'Plan the work. *Agents write the stories.*'}</Headline>
      <Headline at={bt(7)} out={bt(13.6)}>{'You approve. *They pick it up.*'}</Headline>
      <Headline at={bt(14)}>{'PR merged? The card *moves itself.*'}</Headline>
    </AbsoluteFill>
  )
}

function CardView({ card, col, x, y, appear, frame }: { card: Card; col: number; x: number; y: number; appear: number; frame: number }) {
  const tone = col === 5 ? C.green : col === 4 ? C.blue : col === 3 ? C.blue : col === 1 ? C.purple : C.borderStrong
  const blocked = card.waits !== undefined && col === 2
  const changedAt = [...card.timeline].reverse().find(([at]) => frame >= at)?.[0] ?? 0
  const flash = Math.max(0, 1 - (frame - changedAt) / 14)
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: COL_W - 16,
        height: CARD_H,
        padding: '10px 12px',
        boxSizing: 'border-box',
        background: C.elev,
        border: `1px solid ${C.borderStrong}`,
        borderLeft: `3px solid ${tone}`,
        boxShadow: `0 10px 30px #0008${flash > 0 ? `, 0 0 ${30 * flash}px ${tone}66` : ''}`,
        opacity: appear,
        transform: `translateY(${(1 - appear) * -40}px) scale(${0.9 + 0.1 * appear})`,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 13
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.subtle, fontSize: 12 }}>
        {card.n !== undefined && <span>#{card.n}</span>}
        {card.drafted && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', border: `1px solid ${C.border}`, color: C.muted }}>
            <Sparkles size={10} /> {col === 1 ? 'drafted' : card.agent}
          </span>
        )}
        {!card.drafted && card.agent && <span style={{ padding: '1px 6px', border: `1px solid ${C.border}`, color: C.muted }}>{card.agent}</span>}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.2 }}>{card.title}</div>
      <div style={{ display: 'flex', gap: 5 }}>
        {card.labels.map((l) => (
          <span key={l} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 99, border: `1px solid ${C.border}`, color: C.muted }}>
            {l}
          </span>
        ))}
      </div>
      <div style={{ marginTop: 'auto', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: C.muted }}>
        {col === 0 && <span style={{ color: C.subtle }}>not ready yet</span>}
        {col === 1 && <span style={{ color: C.purple }}>waiting for your OK</span>}
        {blocked && (
          <span style={{ color: C.amber, display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            <Hourglass size={12} /> Waits for #{card.waits}
          </span>
        )}
        {col === 2 && !blocked && <span>next up</span>}
        {col === 3 && (
          <div style={{ flex: 1 }}>
            <div style={{ color: C.blue, marginBottom: 5 }}>● {card.agent} · working</div>
            <div style={{ height: 3, background: C.border, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '40%', background: C.blue, transform: `translateX(${((frame * 5 + card.title.length * 40) % 400) - 120}%)` }} />
            </div>
          </div>
        )}
        {col === 4 && (
          <span style={{ color: C.blue, display: 'inline-flex', gap: 5, alignItems: 'center' }}>
            <GitPullRequest size={12} /> PR #{card.pr} · checks passing
          </span>
        )}
        {col === 5 && (
          <span style={{ color: C.green, display: 'inline-flex', gap: 5, alignItems: 'center', fontFamily: MONO, fontSize: 11 }}>
            <Check size={12} /> #{card.pr} · {card.n === 12 ? '14m · 84k tok' : '22m · 120k tok'}
          </span>
        )}
      </div>
    </div>
  )
}
