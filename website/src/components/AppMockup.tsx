import { Bell, Bot, FolderTree, GitPullRequest, ListChecks, Play, Server, Sparkles, SquarePen, Workflow } from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'

type State = 'working' | 'needs' | 'ready' | 'shipped'

interface Mission {
  agent: string
  title: string
  tab: string
  branch: string
}

const missions: Mission[] = [
  { agent: 'Claude Code', title: 'Migrate auth to sessions', tab: 'Migrate auth', branch: 'sldev/auth-sessions' },
  { agent: 'Codex', title: 'Fix flaky checkout test', tab: 'Flaky test', branch: 'sldev/flaky-checkout' },
  { agent: 'Gemini CLI', title: 'Add rate limiting', tab: 'Rate limiting', branch: 'sldev/rate-limit' }
]

const labels: Record<State, string> = { working: 'Working', needs: 'Needs you', ready: 'Ready for you', shipped: 'PR open' }

/** Each mission's status, last line and diff in one scene. */
type Card = [State, string, string]

interface Scene {
  id: string
  title: string
  text: string
  activity: number
  /** which mission is selected, or -1 for the runtimes view */
  active: number
  cards: [Card, Card, Card]
  pane: ReactNode
  toast?: ReactNode
}

/** One line of the pane, revealed after the previous ones. */
function L({ i, children, className }: { i: number; children?: ReactNode; className?: string }) {
  return (
    <div className={`ln${className ? ` ${className}` : ''}`} style={{ '--i': i } as CSSProperties}>
      {children ?? ' '}
    </div>
  )
}

const scenes: Scene[] = [
  {
    id: 'parallel',
    title: 'Run agents side by side',
    text: 'Claude Code, Codex and Gemini each work on their own task, in their own git worktree.',
    activity: 2,
    active: 0,
    cards: [
      ['working', 'Edit src/auth/session.ts', '+84 −31 · 6 files'],
      ['working', 'Run npm test -- checkout', '+3 −1 · 1 file'],
      ['working', 'Read src/middleware/index.ts', 'no changes yet']
    ],
    pane: (
      <pre>
        <L i={0}>$ claude "Migrate auth to sessions"</L>
        <L i={1} />
        <L i={2}><span className="t-dim">● Read</span> src/auth/token.ts</L>
        <L i={3}><span className="t-dim">● Read</span> src/auth/middleware.ts</L>
        <L i={4}><span className="t-green">● Edit</span> src/auth/session.ts</L>
        <L i={5} className="t-green">{'  + export function createSession(user: User) {'}</L>
        <L i={6} className="t-green">{'  +   return store.set(newId(), { user, at: Date.now() })'}</L>
        <L i={7} className="t-red">{'  - const token = jwt.sign({ sub: user.id }, SECRET)'}</L>
        <L i={8}><span className="t-dim">● Bash</span> npm test -- auth</L>
        <L i={10} className="t-green">{'  ✓ 14 passed'}</L>
        <L i={11}><span className="cursor" /></L>
      </pre>
    )
  },
  {
    id: 'needs',
    title: 'Know when one needs you',
    text: 'A status on every mission and a desktop ping the moment an agent waits for a yes.',
    activity: 2,
    active: 1,
    cards: [
      ['working', 'Edit src/auth/routes.ts', '+102 −40 · 8 files'],
      ['needs', 'Waiting for permission', '+12 −4 · 2 files'],
      ['working', 'Write tests/rate-limit.test.ts', '+61 −2 · 3 files']
    ],
    pane: (
      <pre>
        <L i={0}>$ codex "Fix flaky checkout test"</L>
        <L i={1} />
        <L i={2}><span className="t-dim">•</span> The test races the payment mock; awaiting the webhook fixes it.</L>
        <L i={3}><span className="t-green">•</span> Edited tests/checkout.test.ts <span className="t-green">(+12 −4)</span></L>
        <L i={4} />
        <L i={5} className="prompt-box">
          <span className="t-amber">Allow command?</span>
          {'\n'}  npm test -- checkout --runInBand
          {'\n\n'}  <b>› Yes</b>   <span className="t-dim">Always   No</span>
        </L>
      </pre>
    ),
    toast: (
      <>
        <Bell size={14} />
        <span>
          <b>Codex needs you</b>
          <br />
          Fix flaky checkout test
        </span>
      </>
    )
  },
  {
    id: 'review',
    title: 'Review what it changed',
    text: 'Read the diff per file, right next to the terminal that produced it.',
    activity: 2,
    active: 2,
    cards: [
      ['working', 'Run npm test -- auth', '+118 −44 · 9 files'],
      ['working', 'Run npm test -- checkout', '+12 −4 · 2 files'],
      ['ready', 'Done! Added middleware and tests.', '+143 −9 · 5 files']
    ],
    pane: (
      <div className="diff">
        <div className="diff-files">
          <L i={0} className="on">src/middleware/rateLimit.ts <span className="t-green">+48</span></L>
          <L i={0}>src/server.ts <span className="t-green">+3</span> <span className="t-red">−1</span></L>
          <L i={0}>tests/rate-limit.test.ts <span className="t-green">+61</span></L>
          <L i={0}>package.json <span className="t-green">+1</span></L>
        </div>
        <pre>
          <L i={1} className="t-dim">@@ -0,0 +1,48 @@</L>
          <L i={2} className="add">+ import {'{'} RateLimiter {'}'} from './limiter'</L>
          <L i={3} className="add">+</L>
          <L i={4} className="add">+ export function rateLimit(opts: LimitOptions) {'{'}</L>
          <L i={5} className="add">+   const limiter = new RateLimiter(opts.perMinute)</L>
          <L i={6} className="add">+   return (req, res, next) =&gt; {'{'}</L>
          <L i={7} className="add">+     if (limiter.take(req.ip)) return next()</L>
          <L i={8} className="add">+     res.status(429).json({'{'} error: 'Too many requests' {'}'})</L>
          <L i={9} className="t-dim">@@ server.ts -12,7 +12,9 @@</L>
          <L i={10} className="del">- app.use(router)</L>
          <L i={11} className="add">+ app.use('/api', rateLimit({'{'} perMinute: 120 {'}'}))</L>
          <L i={12} className="add">+ app.use(router)</L>
        </pre>
      </div>
    )
  },
  {
    id: 'ship',
    title: 'Ship the pull request',
    text: 'Commit, push and open the PR without leaving the app, then watch the checks come in.',
    activity: 2,
    active: 2,
    cards: [
      ['working', 'Run npm test -- auth', '+118 −44 · 9 files'],
      ['ready', 'Done! Awaiting the webhook.', '+12 −4 · 2 files'],
      ['shipped', 'PR #128 · checks passing', '+143 −9 · 5 files']
    ],
    pane: (
      <div className="pr">
        <L i={0} className="pr-h"><GitPullRequest size={15} /> Open pull request</L>
        <L i={1} className="pr-row"><span className="t-dim">from</span> sldev/rate-limit <span className="t-dim">into</span> main</L>
        <L i={2} className="pr-field">Add rate limiting to the API</L>
        <L i={3} className="pr-field dim">Adds a per-IP limiter (120/min) on /api with tests.</L>
        <L i={4} className="pr-row"><span className="pr-btn">Create pull request</span></L>
        <L i={6} className="pr-done"><span className="t-green">✓</span> Opened #128 on github.com</L>
        <L i={7} className="pr-check"><span className="t-green">✓</span> typecheck <span className="t-dim">18s</span></L>
        <L i={8} className="pr-check"><span className="t-green">✓</span> test <span className="t-dim">41s</span></L>
        <L i={9} className="pr-check"><span className="t-green">✓</span> build <span className="t-dim">1m 02s</span></L>
      </div>
    )
  },
  {
    id: 'runtimes',
    title: 'Run the app, not just the agent',
    text: 'Dev servers, tests and containers detected from your project, with one-click localhost links.',
    activity: 1,
    active: -1,
    cards: [
      ['working', 'Edit src/auth/routes.ts', '+118 −44 · 9 files'],
      ['ready', 'Done! Awaiting the webhook.', '+12 −4 · 2 files'],
      ['shipped', 'PR #128 · checks passing', '+143 −9 · 5 files']
    ],
    pane: (
      <pre>
        <L i={0}>$ npm run dev</L>
        <L i={1} />
        <L i={2}>  <span className="t-green">VITE v8.3.5</span>  ready in 412 ms</L>
        <L i={3} />
        <L i={4}>  ➜  Local:   <u>http://localhost:5173/</u></L>
        <L i={5} className="t-dim">  ➜  Network: use --host to expose</L>
        <L i={6} />
        <L i={7}><span className="t-dim">10:42:07</span> [vite] hmr update /src/routes/login.tsx</L>
        <L i={8}><span className="t-dim">10:42:31</span> [vite] hmr update /src/auth/session.ts</L>
        <L i={9}><span className="cursor" /></L>
      </pre>
    )
  }
]

const runtimes = [
  { name: 'dev', cmd: 'npm run dev', state: 'running', link: 'localhost:5173' },
  { name: 'test:watch', cmd: 'vitest', state: 'running', link: '' },
  { name: 'db', cmd: 'docker compose up', state: 'running', link: 'localhost:5432' },
  { name: 'storybook', cmd: 'npm run storybook', state: 'stopped', link: '' }
]

const icons = [FolderTree, Play, Bot, ListChecks, Sparkles, Workflow, SquarePen, Server]

/** The app window, cycling through what you do with it. Hovering pauses; the tabs jump. */
export function AppShowcase() {
  const [n, setN] = useState(0)
  const scene = scenes[n]
  const next = (): void => setN((n + 1) % scenes.length)
  return (
    <div className="showcase">
      <div className="mock brand-frame" role="img" aria-label={`sldev-io window: ${scene.title}`}>
        <div className="mock-title">
          <span className="mock-dots"><i /><i /><i /></span>
          <span className="mock-name">sldev-io</span>
          <span className="mock-search">Search project <kbd>Ctrl+Shift+P</kbd></span>
        </div>
        <div className="mock-body">
          <div className="mock-activity">
            {icons.map((Icon, i) => (
              <span key={i} className={i === scene.activity ? 'on' : ''}><Icon size={16} /></span>
            ))}
          </div>
          {scene.active < 0 ? (
            <div className="mock-side">
              <div className="mock-side-h">Runtimes</div>
              {runtimes.map((r) => (
                <div key={r.name} className={`mock-rt ${r.state}`}>
                  <div className="mock-card-top">
                    <b><i className={`dot ${r.state === 'running' ? 'ready' : ''}`} /> {r.name}</b>
                    {r.link && <u>{r.link}</u>}
                  </div>
                  <div className="mock-card-branch">{r.cmd}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mock-side">
              <div className="mock-side-h">Agent missions</div>
              <div className="mock-new">New mission</div>
              {missions.map((m, i) => {
                const [state, meta, diff] = scene.cards[i]
                return (
                  <div key={m.title} className={`mock-card ${state}${i === scene.active ? ' sel' : ''}`}>
                    <div className="mock-card-top">
                      <b>{labels[state]}</b>
                      <span>{m.agent}</span>
                    </div>
                    <div className="mock-card-title">{m.title}</div>
                    <div className="mock-card-meta">{meta}</div>
                    <div className="mock-card-branch">{m.branch}</div>
                    <div className="mock-card-diff">{diff}</div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="mock-term">
            <div className="mock-tabs">
              {missions.map((m, i) => (
                <span key={m.tab} className={i === scene.active ? 'active' : ''}>
                  <i className={`dot ${scene.cards[i][0]}`} />
                  {m.tab}
                  {scene.id === 'review' && i === 2 ? ' · diff' : ''}
                </span>
              ))}
              <span className={scene.active < 0 ? 'active' : ''}>
                <i className="dot ready" />
                dev
              </span>
            </div>
            <div className="mock-pane" key={scene.id}>
              {scene.pane}
            </div>
            {scene.toast && (
              <div className="mock-toast" key={`${scene.id}-toast`}>
                {scene.toast}
              </div>
            )}
          </div>
        </div>
        <div className="mock-status">
          <span>⎇ {scene.active >= 0 ? missions[scene.active].branch : 'main'}</span>
          <span>~/projects/shop</span>
          <span className="grow" />
          <span>3 missions</span>
        </div>
      </div>
      <div className="scenes" role="tablist" aria-label="What you can do">
        {scenes.map((s, i) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={i === n}
            className={`scene${i === n ? ' on' : ''}`}
            onClick={() => setN(i)}
          >
            <span className="scene-bar" onAnimationEnd={next} />
            <span className="scene-n">0{i + 1}</span>
            <b>{s.title}</b>
            <span className="scene-text">{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
