import { CircleHelp, Eye, ListChecks, ShieldAlert, Undo2 } from 'lucide-react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { C, MONO, beats, pop, progress, typed } from '../lib'
import { Button, Camera, Headline, Pointer, Scrim, Spotlight, Window, focus } from '../ui'

/** the scene's beats, stretched to the bars it has in src/timeline.json */
const bt = (n: number): number => beats(n * 1.18)

// The review cockpit (src/shared/review.ts): an agent walks you through the change by purpose, noise
// is folded, risky spots are flagged, and every hunk no part claims is still shown, so nothing hides.

const OX = 180 + 56
const OY = 160 + 46

type Kind = 'asked' | 'extra' | 'noise' | 'unclaimed'
const KIND: Record<Kind, { label: string; tone: string }> = {
  asked: { label: 'Asked for', tone: C.green },
  extra: { label: 'Not asked for', tone: C.amber },
  noise: { label: 'Noise, folded', tone: C.subtle },
  unclaimed: { label: 'Not in the walkthrough', tone: C.red }
}

const PARTS: Array<{ title: string; kind: Kind; lines: string; at: number }> = [
  { title: 'The invite endpoint', kind: 'asked', lines: '84 lines', at: bt(1.2) },
  { title: 'The invite email', kind: 'asked', lines: '41 lines', at: bt(1.8) },
  { title: 'A helper for later', kind: 'extra', lines: '12 lines', at: bt(2.4) },
  { title: 'Lockfile and formatting', kind: 'noise', lines: '1,284 lines', at: bt(3) },
  { title: 'src/auth/admin.ts', kind: 'unclaimed', lines: '1 hunk', at: bt(12.5) }
]

const PICK_EXTRA = bt(6.5)
const SEND_BACK = bt(9.2)
const PICK_HIDDEN = bt(13.6)

export function ReviewScene() {
  const frame = useCurrentFrame()
  const win = pop(frame, 0, 18)
  const selected = frame >= PICK_HIDDEN ? 4 : frame >= PICK_EXTRA ? 2 : 0
  const bar = progress(frame, bt(1.2), 30)
  return (
    <AbsoluteFill>
      <Camera
        keys={[
          [0, { y: 100, z: 0.84, rx: 16, ry: 10 }],
          [bt(1.6), { z: 1 }],
          [bt(5.5), { z: 1 }],
          [bt(7.5), focus(OX + 760, OY + 420, 1.3, { ry: -4 })],
          [bt(11.5), focus(OX + 760, OY + 440, 1.3, { ry: -4 })],
          [bt(13.5), focus(OX + 520, OY + 470, 1.36, { ry: 5 })],
          [bt(17), focus(OX + 600, OY + 470, 1.3, { ry: 3 })],
          [bt(18.5), { z: 1 }]
        ]}
      >
        <div style={{ position: 'absolute', left: 180, top: 160, opacity: win }}>
          <Window width={1560} height={880} active={1} title="Review · Invite people by email">
            {/* header */}
            <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 64, padding: '12px 24px', boxSizing: 'border-box', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 16 }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 700 }}>Invite people by email</div>
                <div style={{ fontSize: 13, color: C.muted }}>
                  Codex · <span style={{ color: C.green }}>+201</span> <span style={{ color: C.red }}>−12</span> · 7 files
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <Button style={{ fontSize: 13, padding: '6px 11px', background: C.hover }}>
                  <ListChecks size={14} /> Walkthrough
                </Button>
                <Button style={{ fontSize: 13, padding: '6px 11px' }}>All files</Button>
              </div>
            </div>
            {/* the ask and the walkthrough */}
            <div style={{ position: 'absolute', left: 0, right: 0, top: 64, height: 116, padding: '14px 24px', boxSizing: 'border-box', borderBottom: `1px solid ${C.border}`, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30 }}>
              <div>
                <div style={{ fontSize: 11, letterSpacing: '0.08em', fontWeight: 700, color: C.muted }}>THE ASK</div>
                <div style={{ fontSize: 16, marginTop: 6 }}>Owners invite people by email; invites expire after 7 days.</div>
              </div>
              <div>
                <div style={{ fontSize: 11, letterSpacing: '0.08em', fontWeight: 700, color: C.muted }}>WALKTHROUGH BY CLAUDE CODE</div>
                <div style={{ fontSize: 16, marginTop: 6, minHeight: 22 }}>{typed('Four parts. Two are what was asked; one helper was not.', frame, bt(0.8), 40)}</div>
              </div>
              <div style={{ gridColumn: '1 / 3', display: 'flex', alignItems: 'center', gap: 16, fontSize: 13, color: C.muted }}>
                <div style={{ display: 'flex', width: 700, height: 6, background: C.border, gap: 2 }}>
                  <div style={{ width: `${55 * bar}%`, background: C.green }} />
                  <div style={{ width: `${8 * bar}%`, background: C.amber }} />
                  <div style={{ width: `${35 * bar}%`, background: '#3a3a3a' }} />
                </div>
                <span style={{ color: C.fg }}>137 lines to read</span>
                <span style={{ color: C.subtle }}>· 1,284 lines of noise folded (90%)</span>
              </div>
            </div>
            {/* parts */}
            <div style={{ position: 'absolute', left: 0, top: 180, bottom: 0, width: 380, borderRight: `1px solid ${C.border}`, padding: 14, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {PARTS.map((p, i) => {
                const a = pop(frame, p.at)
                if (frame < p.at) return null
                const k = KIND[p.kind]
                const sel = i === selected
                const hidden = p.kind === 'unclaimed'
                return (
                  <div key={p.title} style={{ marginTop: hidden ? 16 : 0, padding: '11px 12px', background: sel ? C.hover : 'transparent', border: `1px solid ${hidden ? `${C.red}aa` : sel ? C.borderStrong : 'transparent'}`, boxShadow: hidden ? `0 0 ${24 + 20 * Math.max(0, 1 - (frame - p.at) / 20)}px ${C.red}44` : 'none', opacity: a, transform: `translateX(${(1 - a) * -30}px)` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16, fontWeight: 600, color: p.kind === 'noise' ? C.muted : C.fg, fontFamily: hidden ? MONO : undefined }}>
                      <span style={{ width: 22, height: 22, borderRadius: 99, border: `1px solid ${C.borderStrong}`, display: 'grid', placeItems: 'center', fontSize: 11, color: C.muted, fontFamily: 'inherit' }}>{p.kind === 'noise' ? '~' : hidden ? '!' : i + 1}</span>
                      {p.title}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4, marginLeft: 32, display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ color: k.tone }}>● {k.label}</span>
                      <span style={{ color: C.subtle }}>{p.lines}</span>
                      {p.kind === 'extra' && <ShieldAlert size={13} color={C.amber} />}
                    </div>
                  </div>
                )
              })}
            </div>
            {/* the selected part */}
            <div style={{ position: 'absolute', left: 380, right: 0, top: 180, bottom: 0, padding: '22px 28px', boxSizing: 'border-box' }}>
              {selected === 0 && <PartDetail frame={frame} at={bt(1.5)} n={1} kind="asked" title="The invite endpoint" why="POST /invites creates a token, emails it, and expires it after 7 days." risk="Inviting an address twice sends two emails." code={CODE_ASKED} />}
              {selected === 2 && <PartDetail frame={frame} at={PICK_EXTRA} n={3} kind="extra" title="A helper for later" why="A retry wrapper nothing calls yet." code={CODE_EXTRA} sendBack={frame >= SEND_BACK ? typed('Drop the unused helper, keep this PR to the ask.', frame, SEND_BACK + 6, 40) : undefined} />}
              {selected === 4 && <PartDetail frame={frame} at={PICK_HIDDEN} n={0} kind="unclaimed" title="src/auth/admin.ts" why="No part of the walkthrough claims this hunk, so it is shown on its own." code={CODE_HIDDEN} />}
            </div>
            <Spotlight x={0} y={64} w={1504} h={116} at={bt(2.6)} out={bt(5.6)} tone={C.green} label="What was asked, what wasn't, what's noise" side="bottom" />
            <Spotlight x={14} y={498} w={352} h={70} at={bt(13.2)} out={bt(17.6)} tone={C.red} label="No part claimed it, so it's shown anyway" side="bottom" />
            <Pointer
              path={[
                [0, 1200, 760],
                [bt(4.5), 1200, 760],
                [PICK_EXTRA - 4, 160, 335],
                [bt(8), 160, 335],
                [SEND_BACK - 4, 570, 560],
                [bt(12.4), 570, 560],
                [PICK_HIDDEN - 4, 170, 512]
              ]}
              click={[PICK_EXTRA, SEND_BACK, PICK_HIDDEN]}
            />
          </Window>
        </div>
      </Camera>
      <Scrim />
      <Headline at={0} out={bt(5.6)}>{'Review by *purpose,* not by file.'}</Headline>
      <Headline at={bt(6)} out={bt(11.6)}>{'Noise folded. Extras *sent back.*'}</Headline>
      <Headline at={bt(12)}>{'Nothing an agent changed can *hide.*'}</Headline>
    </AbsoluteFill>
  )
}

const CODE_ASKED = [
  ['+', 'export async function invite(team: Team, email: string) {'],
  ['+', '  const token = randomToken(32)'],
  ['+', '  await db.invites.insert({ team: team.id, email, token, expiresAt: days(7) })'],
  ['+', '  await mail.send(inviteEmail(team, email, token))'],
  ['+', '}']
]
const CODE_EXTRA = [
  ['+', 'export async function withRetry<T>(fn: () => Promise<T>, tries = 3) {'],
  ['+', '  for (let i = 0; i < tries - 1; i++) {'],
  ['+', '    try { return await fn() } catch { await sleep(2 ** i * 100) }'],
  ['+', '  }'],
  ['+', '  return fn()']
]
const CODE_HIDDEN = [
  [' ', 'export function requireOwner(req: Request, next: Next) {'],
  ['+', "  if (process.env.SKIP_AUTH) return next()"],
  [' ', '  if (req.user.role !== "owner") throw forbidden()'],
  [' ', '  return next()'],
  [' ', '}']
]

function PartDetail({ frame, at, n, kind, title, why, risk, code, sendBack }: { frame: number; at: number; n: number; kind: Kind; title: string; why: string; risk?: string; code: string[][]; sendBack?: string }) {
  const k = KIND[kind]
  const a = progress(frame, at, 10)
  const hidden = kind === 'unclaimed'
  return (
    <div style={{ opacity: a, transform: `translateY(${(1 - a) * 16}px)` }}>
      <div style={{ fontSize: 14, color: C.muted, display: 'flex', gap: 10 }}>
        {n > 0 && <span>Part {n} of 4</span>}
        <span style={{ color: k.tone }}>● {k.label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6, fontFamily: hidden ? MONO : undefined }}>{title}</div>
      <div style={{ fontSize: 17, color: C.muted, marginTop: 6 }}>{why}</div>
      {(risk || hidden) && (
        <div style={{ marginTop: 16, padding: '12px 16px', border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.red}`, display: 'flex', gap: 12, maxWidth: 760 }}>
          <ShieldAlert size={18} color={C.red} style={{ marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>What could break</div>
            <div style={{ color: C.muted, fontSize: 15, marginTop: 2 }}>{hidden ? 'An env variable skips the owner check.' : risk}</div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button style={{ fontSize: 14, padding: '6px 12px' }}>
          <Eye size={14} /> Looks good
        </Button>
        <Button style={{ fontSize: 14, padding: '6px 12px', borderColor: sendBack !== undefined ? C.amber : C.borderStrong, color: sendBack !== undefined ? C.amber : C.fg }}>
          <Undo2 size={14} /> Send back…
        </Button>
        <Button style={{ fontSize: 14, padding: '6px 12px' }}>
          <CircleHelp size={14} /> Ask why
        </Button>
      </div>
      {sendBack !== undefined && (
        <div style={{ marginTop: 12, padding: '10px 14px', maxWidth: 760, border: `1px solid ${C.amber}88`, background: `${C.amber}0d`, fontSize: 16, minHeight: 22, opacity: interpolate(frame, [SEND_BACK, SEND_BACK + 6], [0, 1], { extrapolateRight: 'clamp' }) }}>
          {sendBack}
          <span style={{ display: 'inline-block', width: 2, height: 18, background: C.amber, marginLeft: 2, verticalAlign: -3, opacity: Math.floor(frame / 12) % 2 }} />
        </div>
      )}
      <div style={{ marginTop: 16, border: `1px solid ${C.border}`, fontFamily: MONO, fontSize: 15, lineHeight: '26px', maxWidth: 1020 }}>
        <div style={{ padding: '6px 12px', borderBottom: `1px solid ${C.border}`, color: C.amber, fontSize: 13 }}>MODIFIED <span style={{ color: C.fg }}>{hidden ? 'src/auth/admin.ts' : kind === 'extra' ? 'src/lib/retry.ts' : 'src/api/invites.ts'}</span></div>
        {code.map(([sign, text], i) => {
          const add = sign === '+'
          const hot = hidden && add
          return (
            <div key={i} style={{ padding: '0 12px', background: hot ? `${C.red}24` : add ? `${C.green}12` : 'transparent', color: hot ? '#ffb3bb' : add ? '#bfeedd' : C.muted, whiteSpace: 'pre', boxShadow: hot ? `inset 3px 0 0 ${C.red}` : undefined }}>
              <span style={{ color: C.subtle, marginRight: 14 }}>{sign}</span>
              {text}
            </div>
          )
        })}
      </div>
    </div>
  )
}
