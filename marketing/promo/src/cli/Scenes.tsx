import type { ReactNode } from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { Bell, Star } from 'lucide-react'
import { BRAND, C, MONO, UI, bars, beats, enter, pop, progress, story, typed } from '../lib'
import { Brand, Camera, Headline, Logo, Scrim, Spotlight, Toast, focus } from '../ui'
import { CHAPTER_LEAD } from '../Film'
import { CLI, CLI_URL } from './data'
import { Bold, CH, Cursor, Dim, Mark, PROMPT, Popup, ROW, Shell, T, TONE, Tui, type Pane } from './Tui'
import timeline from './timeline.json'

// The CLI's story. Every scene stretches its beats to the bars it has in src/cli/timeline.json.
const barsOf = (id: string): number => timeline.scenes.find((s) => s.id === id)?.bars ?? 4
/** the frames a scene has on its own clock (a chapter's title takes the first beat and a half) */
const lenOf = (id: string): number => bars(barsOf(id)) - (timeline.scenes.find((s) => s.id === id && 'chapter' in s) ? CHAPTER_LEAD : 0)

// where the TUI sits on the 1920×1080 stage, so spotlights can point into it
const TX = 140
const TY = 180
const TW = 1640
const TH = 860
const SIDE_W = 30 * CH
/** the top of sidebar item i (0-based) in the first project group, two rows each, under the group's header */
const itemY = (i: number): number => TY + 2 * ROW + ROW / 2 + ROW + i * 2 * ROW

/** lines that appear one by one: [frame, line] */
function Lines({ lines }: { lines: Array<[number, ReactNode]> }) {
  const frame = useCurrentFrame()
  return (
    <>
      {lines.map(([at, l], i) =>
        frame >= at ? (
          <div key={i} style={{ minHeight: ROW, opacity: progress(frame, at, 5), transform: `translateX(${(1 - progress(frame, at, 6)) * -10}px)` }}>
            {l}
          </div>
        ) : null
      )}
    </>
  )
}

const Prompt = ({ children }: { children: ReactNode }) => (
  <div style={{ background: T.raised, margin: `0 -${CH}px ${ROW / 4}px`, padding: `2px ${CH}px` }}>
    <span style={{ color: C.blue }}>› </span>
    {children}
  </div>
)
const Tool = ({ children, stat }: { children: ReactNode; stat?: [number, number] }) => (
  <span>
    <span style={{ color: TONE.working }}>● </span>
    <Bold>{children}</Bold>
    {stat && (
      <>
        {'  '}
        <span style={{ color: TONE.working }}>+{stat[0]}</span> <span style={{ color: TONE.error }}>-{stat[1]}</span>
      </>
    )}
  </span>
)
const Ok = ({ children }: { children: ReactNode }) => (
  <span>
    <span style={{ color: TONE.working }}>{'  ✓ '}</span>
    <Dim>{children}</Dim>
  </span>
)
const Working = () => (
  <span>
    <Mark tone="working" /> <Dim>working…</Dim>
  </span>
)

const stage = (children: ReactNode) => <div style={{ position: 'absolute', left: TX, top: TY }}>{children}</div>

// ---------------------------------------------------------------- 1. a plain shell, three agents started

const OPEN_CMDS: Array<[string, string]> = [
  ['sldev new --agent claude --worktree "Rate-limit the invite endpoint"', '1'],
  ['sldev new --agent codex --worktree "Invite people by email"', '2'],
  ['sldev new --agent gemini --worktree "Owners can remove a member"', '3']
]

export function Open() {
  const frame = useCurrentFrame()
  const len = lenOf('open')
  const CPS = 60
  let t = 10
  const rows: ReactNode[] = []
  for (const [cmd, id] of OPEN_CMDS) {
    const start = t
    const done = start + Math.ceil((cmd.length / CPS) * 30)
    rows.push(
      <div key={cmd}>
        {frame >= start && (
          <div>
            {PROMPT}
            {typed(cmd, frame, start, CPS)}
            {frame < done && <Cursor />}
          </div>
        )}
        {frame >= done + 4 && <div style={{ color: T.dim }}>{id}</div>}
      </div>
    )
    t = done + 12
  }
  const attachAt = t + 4
  return (
    <AbsoluteFill>
      <Headline at={4} out={beats(7)}>
        {'Your agents live in the *terminal.*'}
      </Headline>
      <Headline at={beats(7.5)}>{'So does *sldev.*'}</Headline>
      <Camera keys={[[0, { z: 0.96 }], [len, focus(960, 560, 1.06)]]}>
        <div style={{ position: 'absolute', left: 310, top: 230 }}>
          <Shell width={1300} height={560}>
            {rows}
            {frame >= attachAt && (
              <div>
                {PROMPT}
                {typed('sldev', frame, attachAt, 20)}
                <Cursor />
              </div>
            )}
          </Shell>
        </div>
      </Camera>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------- 2. attached: tabs, status, who needs you

const TEAM = (over: Partial<Record<number, Partial<Pane>>> = {}): Pane[] =>
  [
    { n: 1, title: 'rate-limit', agent: 'claude', branch: 'sldev/rate-limit', project: 'acme-shop', tone: 'working' as const },
    { n: 2, title: 'invites', agent: 'codex', branch: 'sldev/invites', project: 'acme-shop', tone: 'working' as const },
    { n: 3, title: 'members', agent: 'gemini', branch: 'sldev/members', project: 'acme-shop', tone: 'working' as const },
    { n: 4, title: 'shell', cwd: '~/acme-shop', project: 'acme-shop', tone: 'neutral' as const }
  ].map((p) => ({ ...p, ...over[p.n] }))

export function Attach() {
  const frame = useCurrentFrame()
  const len = lenOf('attach')
  const b = len / 22.5 // the scene's beats
  const ASK = Math.round(5 * b)
  const GO = Math.round(10 * b)
  const YES = Math.round(13.5 * b)
  const READY = Math.round(17 * b)
  const active = frame >= GO ? 2 : 1
  const panes = TEAM({
    1: { stat: frame > 2 * b ? { ins: 38, del: 4 } : undefined },
    2: { tone: frame >= ASK && frame < YES ? 'attention' : 'working', stat: { ins: 84, del: 0 } },
    3: { tone: frame >= READY ? 'review' : 'working', stat: { ins: 41, del: 6 } }
  })
  const claude = (
    <Lines
      lines={[
        [0, <Prompt>Rate-limit the invite endpoint</Prompt>],
        [4, <Tool>Read src/api/invites.ts</Tool>],
        [Math.round(1 * b), <Tool>Read src/lib/rateLimit.ts</Tool>],
        [Math.round(2 * b), <Tool stat={[38, 4]}>Edit src/api/invites.ts</Tool>],
        [Math.round(3 * b), <Dim>{'  A token bucket per team: 20 invites an hour.'}</Dim>],
        [Math.round(4 * b), <Working />]
      ]}
    />
  )
  const codex = (
    <Lines
      lines={[
        [GO, <Prompt>Invite people by email</Prompt>],
        [GO, <Tool stat={[84, 0]}>Edited src/api/invites.ts</Tool>],
        [GO, <Tool stat={[41, 0]}>Edited src/email/invite.tsx</Tool>],
        [GO, ' '],
        [GO, <span style={{ color: C.amber }}>Allow Codex to run `npm test`?</span>],
        [GO, <span style={{ color: frame >= YES ? T.dim : C.amber }}>{'  › 1. Yes    2. Always    3. No'}</span>],
        [YES + 4, ' '],
        [YES + 4, <Tool>Bash npm test</Tool>],
        [YES + Math.round(2 * b), <Ok>41 passed</Ok>],
        [YES + Math.round(2.5 * b), <Working />]
      ]}
    />
  )
  const keyAt = (k: string, at: number): string | null => (frame >= at - 6 && frame < at + 8 ? k : null)
  return (
    <AbsoluteFill>
      <Headline at={4} out={ASK - 6}>
        {'Every agent in a *tab.*'}
      </Headline>
      <Headline at={ASK} out={READY - 6}>
        {'It tells you who *needs you.*'}
      </Headline>
      <Headline at={READY}>{'And who is *ready.*'}</Headline>
      <Camera
        keys={[
          [0, { z: 0.9 }],
          [ASK - 4, { z: 0.92 }],
          [ASK + 14, focus(TX + 420, TY + 300, 1.35)],
          [GO + 4, focus(TX + 420, TY + 300, 1.35)],
          [GO + 22, focus(TX + 860, TY + 360, 1.2)],
          [READY - 4, focus(TX + 860, TY + 360, 1.2)],
          [READY + 18, { z: 0.92 }]
        ]}
      >
        {stage(
          <Tui panes={panes} active={active} width={TW} height={TH} pressed={keyAt('2', GO) ?? keyAt('1', YES)}>
            {active === 1 ? claude : codex}
          </Tui>
        )}
        <Spotlight x={TX} y={itemY(1)} w={SIDE_W} h={2 * ROW} at={ASK + 6} out={GO} label="codex needs you" tone={C.amber} side="bottom" />
        <Spotlight x={TX} y={itemY(2)} w={SIDE_W} h={2 * ROW} at={READY + 4} label="ready for review" tone={TONE.review} side="bottom" />
      </Camera>
      <Scrim />
      {/* a desktop notification, outside the terminal */}
      <div style={{ position: 'absolute', right: 40, bottom: 40, width: 440, height: 120, zIndex: 60, transform: 'scale(1.35)', transformOrigin: 'bottom right' }}>
        <Toast at={ASK + 4} out={GO} tone={C.amber} icon={<Bell size={20} />} title="sldev · codex needs you" text="Allow Codex to run `npm test`?" />
      </div>
      <KeyCaps at={GO - 10} keys={['Ctrl', 'b', '2']} out={GO + 16} />
      <KeyCaps at={YES - 8} keys={['1']} out={YES + 14} />
    </AbsoluteFill>
  )
}

/** keys pressed, shown big at the bottom of the frame */
function KeyCaps({ at, out, keys }: { at: number; out: number; keys: string[] }) {
  const frame = useCurrentFrame()
  if (frame < at || frame > out + 10) return null
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 60, display: 'flex', justifyContent: 'center', gap: 14, zIndex: 50, ...enter(frame, at, { dur: 6, rise: 14, out }) }}>
      {keys.map((k, i) => (
        <span key={k + i} style={{ minWidth: 64, padding: '12px 20px', textAlign: 'center', font: `600 30px ${UI}`, color: C.fg, background: '#1b1b1bf2', border: `1px solid ${C.borderStrong}`, borderBottomWidth: 4, borderRadius: 10, boxShadow: '0 20px 50px #000a', transform: `scale(${0.85 + 0.15 * pop(frame, at + i * 3)})` }}>
          {k}
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- 3. a worktree each, changes side by side

const FILES: Array<[string, number, number]> = [
  ['src/api/invites.ts', 38, 4],
  ['src/lib/rateLimit.ts', 22, 0],
  ['test/invites.test.ts', 31, 2]
]
const DIFF: Array<[' ' | '+' | '-', string]> = [
  [' ', 'export async function invite(team: Team, email: string) {'],
  ['+', '  if (!bucket(team.id).take()) {'],
  ['+', "    throw new HttpError(429, 'Too many invites, try again later')"],
  ['+', '  }'],
  [' ', '  const token = randomToken(32)'],
  ['-', '  await db.invites.insert({ team: team.id, email, token })'],
  ['+', '  await db.invites.insert({ team: team.id, email, token, expires: days(7) })'],
  [' ', '  await mail.sendInvite(email, token)']
]

export function Branches() {
  const frame = useCurrentFrame()
  const len = lenOf('branches')
  const b = len / 16
  const V = Math.round(6 * b)
  const panes = TEAM({ 1: { stat: { ins: 91, del: 6 } }, 2: { stat: { ins: 125, del: 0 } }, 3: { tone: 'review', stat: { ins: 41, del: 6 } } })
  const popup =
    frame >= V ? (
      <div style={{ transform: `scale(${0.94 + 0.06 * pop(frame, V)})`, opacity: progress(frame, V, 6) }}>
        <Popup title="Changes · sldev/rate-limit · 3 files  +91 -6" width={1380}>
          <div style={{ display: 'flex', gap: 3 * CH }}>
            <div style={{ width: 30 * CH }}>
              {FILES.map(([f, a, d], i) => (
                <div key={f} style={{ background: i === 0 ? T.muted : 'transparent', padding: `0 ${CH}px` }}>
                  {f.split('/').pop()} <span style={{ color: TONE.working }}>+{a}</span> <span style={{ color: TONE.error }}>-{d}</span>
                </div>
              ))}
            </div>
            <div style={{ flex: 1, fontSize: 18, lineHeight: '30px' }}>
              {DIFF.map(([k, l], i) => (
                <div key={i} style={{ background: k === '+' ? `${C.green}1a` : k === '-' ? `${C.red}1f` : 'transparent', color: k === ' ' ? T.dim : T.fg, padding: `0 ${CH}px`, opacity: progress(frame, V + 4 + i * 2, 5) }}>
                  <span style={{ color: k === '+' ? TONE.working : k === '-' ? TONE.error : T.subtle }}>{k}</span> {l}
                </div>
              ))}
            </div>
          </div>
        </Popup>
      </div>
    ) : undefined
  return (
    <AbsoluteFill>
      <Headline at={4} out={V - 6}>
        {'Each one on *its own branch.*'}
      </Headline>
      <Headline at={V}>{'Every change, *one key away.*'}</Headline>
      <Camera
        keys={[
          [0, focus(TX + 520, TY + 260, 1.3)],
          [V - 10, focus(TX + 1100, TY + 60, 1.25)],
          [V + 8, { z: 0.92 }],
          [len, { z: 0.95 }]
        ]}
      >
        {stage(
          <Tui panes={panes} active={1} width={TW} height={TH} popup={popup} pressed={frame >= V - 6 && frame < V + 8 ? 'v' : null}>
            <Lines
              lines={[
                [0, <Prompt>Rate-limit the invite endpoint</Prompt>],
                [0, <Tool stat={[38, 4]}>Edit src/api/invites.ts</Tool>],
                [0, <Tool stat={[22, 0]}>Write src/lib/rateLimit.ts</Tool>],
                [Math.round(1 * b), <Tool stat={[31, 2]}>Edit test/invites.test.ts</Tool>],
                [Math.round(2 * b), <Working />]
              ]}
            />
          </Tui>
        )}
        <Spotlight x={TX + SIDE_W + CH} y={TY + ROW} w={TW - SIDE_W - CH - 10} h={ROW} at={Math.round(1.5 * b)} out={V - 8} label="sldev/rate-limit · its own worktree" tone={C.green} side="bottom" />
      </Camera>
      <Scrim />
      <KeyCaps at={V - 10} keys={['Ctrl', 'b', 'v']} out={V + 16} />
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------- 4. usage limit, the next agent continues

export function Failover() {
  const frame = useCurrentFrame()
  const len = lenOf('failover')
  const b = len / 10.5
  const LIMIT = Math.round(2.5 * b)
  const SWAP = Math.round(5.5 * b)
  const swapped = frame >= SWAP
  const panes: Pane[] = [
    ...TEAM({
      1: { tone: frame >= LIMIT ? 'attention' : 'working', state: swapped ? 'usage limit · went on in 5' : frame >= LIMIT ? 'usage limit' : undefined, stat: { ins: 91, del: 6 } },
      3: { tone: 'review' }
    }),
    ...(swapped ? [{ n: 5, title: 'rate-limit', agent: 'codex', branch: 'sldev/rate-limit', project: 'acme-shop', tone: 'working' as const, state: 'went on from 1', stat: { ins: 91, del: 6 } }] : [])
  ]
  return (
    <AbsoluteFill>
      <Headline at={0} out={SWAP - 6}>
        {'Hit the usage limit *mid-task?*'}
      </Headline>
      <Headline at={SWAP}>{'The next agent *carries on.*'}</Headline>
      <div style={{ position: 'absolute', right: 40, bottom: 40, width: 440, height: 120, zIndex: 60, transform: 'scale(1.35)', transformOrigin: 'bottom right' }}>
        <Toast at={SWAP + 2} tone={C.green} icon={<Bell size={20} />} title="rate-limit: continued on Codex" text="Claude Code hit its usage limit" />
      </div>
      <Camera keys={[[0, focus(TX + 700, TY + 330, 1.15)], [len, focus(TX + 700, TY + 360, 1.22)]]}>
        {stage(
          <Tui panes={panes} active={swapped ? 5 : 1} width={TW} height={TH}>
            <Lines
              lines={
                swapped
                  ? [
                      [SWAP, <Prompt>Rate-limit the invite endpoint</Prompt>],
                      [SWAP + 4, <Dim>{'  Picking up where claude stopped: sldev/rate-limit, +91 -6, tests not run yet.'}</Dim>],
                      [SWAP + Math.round(1 * b), <Tool>Bash npm test</Tool>],
                      [SWAP + Math.round(2.5 * b), <Ok>44 passed</Ok>],
                      [SWAP + Math.round(3 * b), <Working />]
                    ]
                  : [
                      [0, <Prompt>Rate-limit the invite endpoint</Prompt>],
                      [0, <Tool stat={[31, 2]}>Edit test/invites.test.ts</Tool>],
                      [Math.round(1 * b), <Tool>Bash npm test</Tool>],
                      [LIMIT, ' '],
                      [LIMIT, <span style={{ color: C.amber }}>{"  You've hit your usage limit · resets 3pm"}</span>]
                    ]
              }
            />
          </Tui>
        )}
        <Spotlight x={TX} y={itemY(0)} w={SIDE_W} h={2 * ROW} at={LIMIT + 4} out={SWAP - 2} label="--failover codex,gemini" tone={C.amber} side="bottom" />
        <Spotlight x={TX} y={itemY(3)} w={SIDE_W} h={2 * ROW} at={SWAP + 2} label="codex, same worktree" tone={C.green} side="bottom" />
      </Camera>
      <Scrim />
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------- 5. repeat: pass after pass, a check between

export function Repeat() {
  const frame = useCurrentFrame()
  const len = lenOf('repeat')
  const b = len / 16
  const at = (n: number): number => Math.round(n * b)
  const pass = frame < at(4) ? 1 : frame < at(8) ? 2 : frame < at(12) ? 3 : 4
  const panes: Pane[] = [
    { n: 5, title: `settings ↻ ${pass}/4`, agent: 'claude', branch: 'sldev/settings', project: 'acme-shop', tone: 'working', state: `pass ${pass} of 4`, stat: { ins: 40 + pass * 26, del: 9 + pass * 3 } },
    { n: 1, title: 'rate-limit', agent: 'codex', branch: 'sldev/rate-limit', project: 'acme-shop', tone: 'review', stat: { ins: 91, del: 6 } },
    { n: 4, title: 'shell', cwd: '~/acme-shop', project: 'acme-shop', tone: 'neutral' }
  ]
  return (
    <AbsoluteFill>
      <Headline at={0} out={at(8) - 6}>
        {'Run it again, *pass after pass.*'}
      </Headline>
      <Headline at={at(8)}>{'A failing check goes to *the next pass.*'}</Headline>
      <Camera keys={[[0, { z: 0.92 }], [at(3), focus(TX + 780, TY + 330, 1.08)], [len, focus(TX + 800, TY + 350, 1.13)]]}>
        {stage(
          <Tui panes={panes} active={5} width={TW} height={TH}>
            <Lines
              lines={[
                [0, <Prompt>Polish the settings page</Prompt>],
                [0, <Dim>{'  ↻ sldev new --repeat 4 --check "npm test"'}</Dim>],
                [0, ' '],
                [at(1), <PassLine n={1} ok text="committed 3f2a91c · check passed" />],
                [at(5), <PassLine n={2} text="committed 8b1d0e4 · npm test: 1 failed" />],
                [at(6), <Dim>{'           → the failure goes to pass 3'}</Dim>],
                [at(9), <PassLine n={3} ok text="committed c47e2a1 · fixed the failing test · check passed" />],
                [at(13), <span><Mark tone="working" /> <Dim>pass 4 of 4…</Dim></span>]
              ]}
            />
          </Tui>
        )}
      </Camera>
      <Scrim />
    </AbsoluteFill>
  )
}

function PassLine({ n, ok, text }: { n: number; ok?: boolean; text: string }) {
  return (
    <span>
      <span style={{ color: ok ? TONE.working : TONE.error }}>{ok ? '✓' : '✗'}</span> <Bold>pass {n}</Bold> <Dim>{text}</Dim>
    </span>
  )
}

// ---------------------------------------------------------------- 6. a conductor: one agent runs the others

export function Conductor() {
  const frame = useCurrentFrame()
  const len = lenOf('conductor')
  const b = len / 18.5
  const at = (n: number): number => Math.round(n * b)
  const kid = (n: number, title: string, agent: string, start: number, end: number, stat: { ins: number; del: number }): Pane | null =>
    frame < start ? null : { n, title, agent, project: 'acme-shop', child: true, tone: frame >= end ? 'done' : 'working', stat: frame >= end ? stat : undefined }
  const lead: Pane = { n: 6, title: 'migration', agent: 'claude', branch: 'sldev/migration', project: 'acme-shop', tone: frame >= at(13) ? 'review' : 'working', state: frame >= at(13) ? 'ready' : 'conducting', stat: frame >= at(11) ? { ins: 412, del: 133 } : undefined }
  const panes = [lead, kid(7, 'm-schema', 'codex', at(2), at(7), { ins: 120, del: 41 }), kid(8, 'm-api', 'gemini', at(2.6), at(8), { ins: 188, del: 62 }), kid(9, 'm-tests', 'cursor', at(3.2), at(9), { ins: 104, del: 30 })].filter((p): p is Pane => !!p)
  return (
    <AbsoluteFill>
      <Headline at={0} out={at(10) - 6}>
        {'One agent *runs the others.*'}
      </Headline>
      <Headline at={at(10)}>{'It merges their work. *You push.*'}</Headline>
      <Camera keys={[[0, { z: 0.92 }], [at(4), focus(TX + 600, TY + 330, 1.12)], [at(12), focus(TX + 820, TY + 360, 1.18)], [len, { z: 0.95 }]]}>
        {stage(
          <Tui panes={panes} active={6} width={TW} height={TH}>
            <Lines
              lines={[
                [0, <Prompt>Move accounts to the new schema; split it between other agents</Prompt>],
                [0, <Dim>{'  sldev new --allow-spawn 3 · sldev-conductor'}</Dim>],
                [at(1), <Dim>{'  Three parts that touch different files.'}</Dim>],
                [at(2), <Tool>sldev new --agent codex "Schema and migration"</Tool>],
                [at(2.6), <Tool>sldev new --agent gemini "API on the new schema"</Tool>],
                [at(3.2), <Tool>sldev new --agent cursor "Tests for the migration"</Tool>],
                [at(4), <Tool>sldev wait 7 --for done</Tool>],
                [at(9.5), <Ok>3 of 3 done</Ok>],
                [at(10.5), <Tool stat={[412, 133]}>git merge sldev/m-schema sldev/m-api sldev/m-tests</Tool>],
                [at(11.5), <Tool>Bash npm test</Tool>],
                [at(12.5), <Ok>212 passed · nothing pushed</Ok>]
              ]}
            />
          </Tui>
        )}
        <Spotlight x={TX} y={itemY(1)} w={SIDE_W} h={6 * ROW} at={at(4.5)} out={at(10)} label="its own agents, each in a worktree" tone={C.green} side="bottom" />
      </Camera>
      <Scrim />
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------- 7. scriptable

export function Script() {
  const frame = useCurrentFrame()
  const len = lenOf('script')
  const CMD = 'sldev wait 2 --for needs-you && sldev send 2 "yes"'
  const typedAt = 8
  const done = typedAt + Math.ceil((CMD.length / 70) * 30)
  return (
    <AbsoluteFill>
      <Headline at={0}>{'And all of it is *scriptable.*'}</Headline>
      <Camera keys={[[0, { z: 0.98 }], [len, focus(960, 520, 1.08)]]}>
        <div style={{ position: 'absolute', left: 310, top: 280 }}>
          <Shell width={1300} height={360} title="zsh — ~/acme-shop">
            <div>
              {PROMPT}
              {typed(CMD, frame, typedAt, 70)}
              {frame < done + 30 && <Cursor />}
            </div>
            {frame >= done + 30 && <div style={{ color: T.dim }}>2 needs you: Allow Codex to run `npm test`?</div>}
            {frame >= done + 40 && <div style={{ color: TONE.working }}>sent to 2</div>}
            {frame >= done + 40 && (
              <div>
                {PROMPT}
                <Cursor />
              </div>
            )}
          </Shell>
        </div>
      </Camera>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------- 8. every agent

export function Agents() {
  const frame = useCurrentFrame()
  const len = lenOf('agents')
  const names = CLI.agents
  const step = (len * 0.55) / names.length
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ font: story(56), color: '#c4c4c4', ...enter(frame, 0) }}>Every agent, side by side</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 16, maxWidth: 1400, marginTop: 50 }}>
        {names.map((a, i) => {
          const p = pop(frame, 8 + i * step)
          const last = i === names.length - 1
          return (
            <span key={a} style={{ padding: '14px 26px', font: `600 34px ${UI}`, border: `1px solid ${last ? C.green : C.borderStrong}`, background: C.elev, borderRadius: 8, opacity: p, transform: `translateY(${(1 - p) * 26}px) scale(${0.9 + 0.1 * p})`, ...(last ? { color: C.green } : {}) }}>
              {a}
            </span>
          )
        })}
      </div>
      <div style={{ marginTop: 60, font: `500 34px ${UI}`, color: C.muted, ...enter(frame, Math.round(len * 0.62)) }}>
        No account · no telemetry · <span style={{ color: C.fg }}>free and open source</span>
      </div>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------- 9. call to action

export function Cta() {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', left: 960, top: 470, width: 1300, height: 1300, transform: `translate(-50%, -50%) rotate(${frame * 0.6}deg)`, borderRadius: '50%', background: `conic-gradient(from 0deg, ${C.blue}00, ${C.blue}40, ${C.green}40, ${C.purple}40, ${C.blue}00 70%)`, filter: 'blur(90px)', opacity: 0.5 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 26, position: 'relative', ...enter(frame, 0, { dur: 10, rise: 0 }) }}>
        <Logo size={140} />
        <div style={{ font: `700 150px/1.1 ${UI}`, letterSpacing: '-0.05em' }}>
          <Brand>{CLI.name}</Brand>
        </div>
      </div>
      <div style={{ marginTop: 18, font: story(54, 1.2), color: '#c4c4c4', position: 'relative', ...enter(frame, beats(1)) }}>{CLI.tagline}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 64, position: 'relative', ...enter(frame, beats(2.5)) }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: '16px 28px', border: `1px solid ${C.borderStrong}`, borderRadius: 8, background: C.elev, font: `600 30px ${UI}` }}>
          <Star size={28} color={C.purple} /> Free and open source
        </span>
        <span style={{ font: `500 30px ${UI}`, color: C.muted }}>Apache-2.0 · {CLI.requires.split(' · ')[1]}</span>
      </div>
      <div style={{ marginTop: 26, font: `500 24px ${UI}`, color: C.muted, position: 'relative', ...enter(frame, beats(3.5)) }}>
        Works on its own, or next to the <span style={{ color: C.fg }}>sldev-io</span> app
      </div>
      <div style={{ marginTop: 56, padding: '18px 34px', border: `1px solid ${C.borderStrong}`, borderRadius: 10, background: '#0b0b0bdd', font: `600 52px ${MONO}`, letterSpacing: '-0.02em', position: 'relative', ...enter(frame, beats(5)) }}>
        <span style={{ color: C.green }}>$ </span>
        {CLI.install}
      </div>
      <div style={{ marginTop: 22, font: `500 30px ${MONO}`, color: C.muted, position: 'relative', ...enter(frame, beats(6)) }}>{CLI_URL}</div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: BRAND, opacity: interpolate(frame, [0, 30], [0, 0.8], { extrapolateRight: 'clamp' }) }} />
    </AbsoluteFill>
  )
}
