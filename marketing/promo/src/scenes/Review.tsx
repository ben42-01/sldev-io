import { GitBranch, GitPullRequest } from 'lucide-react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { C, MONO, beats, pop } from '../lib'
import { Button, Headline, Pill, Pointer, Toast, Window } from '../ui'

const FILES: Array<[string, string, string]> = [
  ['src/auth/session.ts', '+84', '−12'],
  ['src/auth/routes.ts', '+22', '−30'],
  ['src/auth/middleware.ts', '+9', '−2'],
  ['test/auth.test.ts', '+3', '−0']
]

const DIFF: Array<[' ' | '+' | '-', string]> = [
  [' ', "import { Router } from 'express'"],
  ['-', "import jwt from 'jsonwebtoken'"],
  ['+', "import { createSession, readSession } from './session'"],
  [' ', ''],
  [' ', "router.post('/login', async (req, res) => {"],
  [' ', '  const user = await verify(req.body)'],
  ['-', "  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '1h' })"],
  ['-', '  res.json({ token })'],
  ['+', '  const session = await createSession(user.id)'],
  ['+', "  res.cookie('sid', session.id, { httpOnly: true, sameSite: 'lax' })"],
  ['+', '  res.json({ ok: true })'],
  [' ', '})'],
  [' ', ''],
  ['+', "router.post('/logout', async (req, res) => {"],
  ['+', '  await readSession(req)?.destroy()'],
  ['+', "  res.clearCookie('sid').json({ ok: true })"],
  ['+', '})']
]

/** The finished mission: its diff, then commit and open the PR from the app. */
export function Review() {
  const frame = useCurrentFrame()
  const win = pop(frame, 0, 18)
  const opened = frame >= beats(13)
  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <Headline at={0} out={beats(7)}>Review every line it changed.</Headline>
      <Headline at={beats(8)}>Commit. Merge. *Open the PR.*</Headline>
      <div style={{ position: 'absolute', top: 180, opacity: win, transform: `translateY(${(1 - win) * 60}px)` }}>
        <Window width={1560} height={880} active={1}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 22px', borderBottom: `1px solid ${'#1f1f1f'}`, display: 'flex', alignItems: 'center', gap: 14 }}>
              <Pill state={opened ? 'shipped' : 'ready'} />
              <div>
                <div style={{ fontSize: 21, fontWeight: 700 }}>Migrate auth to sessions</div>
                <div style={{ fontSize: 14, color: C.muted, display: 'flex', gap: 6, alignItems: 'center', fontFamily: MONO }}>
                  <GitBranch size={13} /> sldev/auth-sessions · Claude Code · <span style={{ color: C.green }}>+118</span> <span style={{ color: C.red }}>−44</span>
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                <Button>Commit</Button>
                <Button>Merge</Button>
                <Button primary glow={frame > beats(10) && frame < beats(12) ? 1 : 0}>
                  <GitPullRequest size={16} /> Open PR
                </Button>
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              <div style={{ width: 330, borderRight: '1px solid #1f1f1f', padding: '10px 0' }}>
                {FILES.map(([f, a, d], i) => (
                  <div key={f} style={{ padding: '9px 18px', fontFamily: MONO, fontSize: 14, display: 'flex', gap: 8, background: i === 1 ? C.hover : 'transparent', boxShadow: i === 1 ? `inset 2px 0 0 ${C.blue}` : 'none', color: i === 1 ? C.fg : C.muted }}>
                    <span style={{ flex: 1 }}>{f.split('/').pop()}</span>
                    <span style={{ color: C.green }}>{a}</span>
                    <span style={{ color: C.red }}>{d}</span>
                  </div>
                ))}
              </div>
              <div style={{ flex: 1, padding: '14px 0', fontFamily: MONO, fontSize: 17, lineHeight: 1.65 }}>
                {DIFF.map(([k, l], i) => {
                  const show = frame >= 6 + i * 4
                  const bg = k === '+' ? `${C.green}14` : k === '-' ? `${C.red}14` : 'transparent'
                  const fg = k === '+' ? C.green : k === '-' ? C.red : '#bdbdbd'
                  return (
                    <div key={i} style={{ display: 'flex', background: bg, opacity: show ? 1 : 0, transform: `translateX(${show ? 0 : -10}px)` }}>
                      <span style={{ width: 54, textAlign: 'right', paddingRight: 14, color: C.subtle }}>{i + 12}</span>
                      <span style={{ width: 24, color: fg }}>{k === ' ' ? '' : k}</span>
                      <span style={{ color: k === ' ' ? '#bdbdbd' : fg, whiteSpace: 'pre' }}>{l}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
          <Toast at={beats(13)} tone={C.purple} icon={<GitPullRequest size={20} />} title="Pull request #128 opened" text="acme/shop · checks running" />
          <Pointer
            path={[
              [0, 900, 600],
              [beats(8), 900, 600],
              [beats(11), 1440, 40]
            ]}
            click={[beats(12)]}
          />
        </Window>
      </div>
    </AbsoluteFill>
  )
}
