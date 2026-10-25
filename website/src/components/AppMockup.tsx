import { Bell, Bot, Factory, FolderTree, GitPullRequest, ListChecks, Play, Server, Sparkles, SquarePen, Workflow } from 'lucide-react'
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
  /** which mission is selected, or -1 for none */
  active: number
  /** sidebar view; missions unless said otherwise */
  side?: 'runtimes' | 'factory'
  /** the extra tab's label, active when no mission is */
  tab?: string
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
    id: 'factory',
    title: 'Idea in, pull request out',
    text: 'Spec, parallel builds, tests and review run as one graph of agents. You approve what matters.',
    activity: 3,
    active: -1,
    side: 'factory',
    tab: 'Pipeline',
    cards: [
      ['working', 'Edit src/auth/routes.ts', '+118 −44 · 9 files'],
      ['ready', 'Done! Awaiting the webhook.', '+12 −4 · 2 files'],
      ['shipped', 'PR #128 · checks passing', '+143 −9 · 5 files']
    ],
    pane: <PipelineMock />
  },
  {
    id: 'bakeoff',
    title: 'Let two agents race',
    text: 'Same task, two agents. Compare the diffs and tests, keep the best.',
    activity: 3,
    active: -1,
    side: 'factory',
    tab: 'Pipeline',
    cards: [
      ['working', 'Edit src/auth/routes.ts', '+118 −44 · 9 files'],
      ['ready', 'Done! Awaiting the webhook.', '+12 −4 · 2 files'],
      ['shipped', 'PR #128 · checks passing', '+143 −9 · 5 files']
    ],
    pane: (
      <div className="bo">
        <L i={0} className="bo-head"><b>compare</b> · Claude Code vs Codex · <span className="t-amber">keep one</span></L>
        <div className="bo-grid">
          {[
            { agent: 'Claude Code', stat: ['+142', '−9', '5 files'], tests: '14 passed', lines: ['+ export function rateLimit(opts) {', '+   const bucket = new TokenBucket(opts)', '+   return (req, res, next) => …'], win: true },
            { agent: 'Codex', stat: ['+98', '−31', '4 files'], tests: '12 passed, 2 failed', lines: ['+ app.use(limiter({ max: 120 }))', '- app.use(router)', '+ import limiter from "express-limit"'], win: false }
          ].map((c, k) => (
            <div key={c.agent} className={`bo-card${c.win ? ' win' : ''}`}>
              <L i={1 + k}><b>{c.agent}</b></L>
              <L i={2 + k} className="mono"><span className="t-green">{c.stat[0]}</span> <span className="t-red">{c.stat[1]}</span> · {c.stat[2]}</L>
              <L i={3 + k} className={`mono ${c.win ? 't-green' : 't-red'}`}>{c.win ? '✓' : '✗'} {c.tests}</L>
              {c.lines.map((l, j) => (
                <L key={j} i={4 + k + j} className={`mono small ${l.startsWith('-') ? 't-red' : 't-green'}`}>{l}</L>
              ))}
              <L i={8 + k}><span className={`pr-btn${c.win ? ' press' : ''}`}>Keep</span></L>
            </div>
          ))}
        </div>
        <L i={11} className="bo-foot"><span className="t-green">✓</span> Kept Claude Code · its branch flows on to verify and the pull request</L>
      </div>
    )
  },
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
    side: 'runtimes',
    tab: 'dev',
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

/** The factory pipeline as a small graph: columns follow the recipe, parallel builds stack. */
function PipelineMock() {
  const nodes = [
    { id: 'spec', who: 'Spec writer', x: 10, y: 105, st: 'done', label: 'Done' },
    { id: 'api', who: 'Implementer · Claude', x: 160, y: 35, st: 'done', label: 'Done' },
    { id: 'ui', who: 'Implementer · Codex', x: 160, y: 175, st: 'done', label: 'Done' },
    { id: 'verify', who: 'npm test · try 2', x: 310, y: 105, st: 'done', label: 'Done' },
    { id: 'review', who: 'Reviewer · Gemini', x: 460, y: 105, st: 'needs', label: 'Needs you' },
    { id: 'pr', who: 'into main', x: 610, y: 105, st: 'wait', label: 'Waiting' }
  ]
  const W = 130
  const H = 64
  const at = (id: string) => nodes.find((n) => n.id === id)!
  const edges: Array<[string, string]> = [['spec', 'api'], ['spec', 'ui'], ['api', 'verify'], ['ui', 'verify'], ['verify', 'review'], ['review', 'pr']]
  return (
    <div className="fx">
      <L i={0} className="fx-head"><b>Feature</b> · Add dark mode · <span className="t-dim">5/6 steps · sldev/factory-dark-mode</span></L>
      <svg viewBox="0 0 750 260" className="fx-graph" aria-hidden="true">
        {edges.map(([a, b], k) => {
          const p = at(a)
          const q = at(b)
          const x1 = p.x + W
          const y1 = p.y + H / 2
          const x2 = q.x
          const y2 = q.y + H / 2
          return <path key={k} className="fx-edge ln-svg" style={{ '--i': k + 1 } as CSSProperties} d={`M${x1},${y1} C${x1 + 10},${y1} ${x2 - 10},${y2} ${x2},${y2}`} />
        })}
        <path className="fx-retry ln-svg" style={{ '--i': 6 } as CSSProperties} d={`M${at('verify').x + W / 2},${at('verify').y + H} C${at('verify').x + W / 2},250 ${at('ui').x + W / 2},258 ${at('ui').x + W / 2},${at('ui').y + H}`} />
        {nodes.map((n, k) => (
          <g key={n.id} className={`fx-node ${n.st} ln-svg`} style={{ '--i': k + 1 } as CSSProperties}>
            <rect x={n.x} y={n.y} width={W} height={H} rx={2} />
            <rect x={n.x} y={n.y} width={W} height={2} className="fx-top" />
            <text x={n.x + 9} y={n.y + 20} className="fx-id">{n.id}</text>
            <text x={n.x + W - 8} y={n.y + 20} className="fx-st" textAnchor="end">{n.label}</text>
            <text x={n.x + 9} y={n.y + 38} className="fx-who">{n.who}</text>
            {n.id === 'review' && <text x={n.x + 9} y={n.y + 56} className="fx-act">Approve · Reject</text>}
          </g>
        ))}
      </svg>
    </div>
  )
}

const factoryRuns = [
  { state: 'needs', label: 'Needs you', recipe: 'Feature', intent: 'Add dark mode', done: 5, total: 6 },
  { state: 'working', label: 'Running', recipe: 'Bake-off', intent: 'Rate limit the API', done: 1, total: 3 },
  { state: 'ready', label: 'Done', recipe: 'Bug fix', intent: 'Login on Safari (#42)', done: 4, total: 4 }
]

const runtimes = [
  { name: 'dev', cmd: 'npm run dev', state: 'running', link: 'localhost:5173' },
  { name: 'test:watch', cmd: 'vitest', state: 'running', link: '' },
  { name: 'db', cmd: 'docker compose up', state: 'running', link: 'localhost:5432' },
  { name: 'storybook', cmd: 'npm run storybook', state: 'stopped', link: '' }
]

const icons = [FolderTree, Play, Bot, Factory, ListChecks, Sparkles, Workflow, SquarePen, Server]

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
          {scene.side === 'factory' ? (
            <div className="mock-side">
              <div className="mock-side-h">Factory</div>
              <div className="mock-new">New factory run</div>
              {factoryRuns.map((r, i) => (
                <div key={r.intent} className={`mock-card ${r.state}${(scene.id === 'factory' ? 0 : 1) === i ? ' sel' : ''}`}>
                  <div className="mock-card-top">
                    <b>{r.label}</b>
                    <span>{r.recipe}</span>
                  </div>
                  <div className="mock-card-title">{r.intent}</div>
                  <div className="mock-run-bar"><i style={{ width: `${(r.done / r.total) * 100}%` }} /></div>
                  <div className="mock-card-diff">{r.done}/{r.total} steps</div>
                </div>
              ))}
            </div>
          ) : scene.side === 'runtimes' ? (
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
                {scene.tab ?? 'dev'}
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
