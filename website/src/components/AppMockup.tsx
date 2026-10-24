import { Bot, FolderTree, ListChecks, Play, Server, Sparkles, SquarePen, Workflow } from 'lucide-react'

const missions = [
  { state: 'working', label: 'Working', agent: 'Claude Code', title: 'Migrate auth to sessions', meta: 'Edit src/auth/session.ts', branch: 'sldev/auth-sessions', diff: '+84 −31 · 6 files' },
  { state: 'needs', label: 'Needs you', agent: 'Codex', title: 'Fix flaky checkout test', meta: 'Waiting for permission', branch: 'sldev/flaky-checkout', diff: '+12 −4 · 2 files' },
  { state: 'ready', label: 'Ready for you', agent: 'Gemini CLI', title: 'Add rate limiting', meta: 'Done! Added middleware and tests.', branch: 'sldev/rate-limit', diff: '+143 −9 · 5 files' }
]

const icons = [FolderTree, Play, Bot, ListChecks, Sparkles, Workflow, SquarePen, Server]

export function AppMockup() {
  return (
    <div className="mock brand-frame" role="img" aria-label="sldev-io window showing three agent missions and a live terminal">
      <div className="mock-title">
        <span className="mock-dots"><i /><i /><i /></span>
        <span className="mock-name">sldev-io</span>
        <span className="mock-search">Search project <kbd>Ctrl+Shift+P</kbd></span>
      </div>
      <div className="mock-body">
        <div className="mock-activity">
          {icons.map((Icon, i) => (
            <span key={i} className={i === 2 ? 'on' : ''}><Icon size={16} /></span>
          ))}
        </div>
        <div className="mock-side">
          <div className="mock-side-h">Agent missions</div>
          <div className="mock-new">New mission</div>
          {missions.map((m) => (
            <div key={m.title} className={`mock-card ${m.state}`}>
              <div className="mock-card-top">
                <b>{m.label}</b>
                <span>{m.agent}</span>
              </div>
              <div className="mock-card-title">{m.title}</div>
              <div className="mock-card-meta">{m.meta}</div>
              <div className="mock-card-branch">{m.branch}</div>
              <div className="mock-card-diff">{m.diff}</div>
            </div>
          ))}
        </div>
        <div className="mock-term">
          <div className="mock-tabs">
            <span className="active"><i className="dot working" />Migrate auth</span>
            <span><i className="dot needs" />Flaky test</span>
            <span><i className="dot ready" />Rate limiting</span>
          </div>
          <pre>
{`$ claude --settings claude-hooks.json "Migrate auth to sessions"

`}<span className="t-dim">● Read</span>{` src/auth/token.ts
`}<span className="t-dim">● Read</span>{` src/auth/middleware.ts
`}<span className="t-green">● Edit</span>{` src/auth/session.ts
  `}<span className="t-green">{'+ export function createSession(user: User) {'}</span>{`
  `}<span className="t-green">{'+   return store.set(newId(), { user, at: Date.now() })'}</span>{`
  `}<span className="t-red">{'- const token = jwt.sign({ sub: user.id }, SECRET)'}</span>{`
`}<span className="t-dim">● Bash</span>{` npm test -- auth
`}<span className="t-green">  ✓ 14 passed</span>{`
`}<span className="cursor" /></pre>
        </div>
      </div>
      <div className="mock-status"><span>⎇ main</span><span>~/projects/shop</span><span className="grow" /><span>3 missions</span></div>
    </div>
  )
}
