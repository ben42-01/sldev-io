import { ArrowRight, ArrowUp, Check, CircleDot, Hourglass, Sparkles, Trophy } from 'lucide-react'
import { L, useSeen } from './Workflows'

/**
 * The agent team: a Lead that delegates to other agents, a board where agents write the stories and
 * pick up what you approved, and evals that measure which agent does the work best. Together they are
 * what a single-vendor tool can't offer: agents from different vendors working as one team, on data.
 */

/** A Lead mission plans, delegates to three agents, reviews, sends one back and integrates. Replays on scroll. */
export function LeadSpotlight() {
  const [ref, seen] = useSeen<HTMLDivElement>()
  return (
    <section className="section" id="lead">
      <div className="container split">
        <div>
          <p className="eyebrow">Lead missions · new</p>
          <h2>One agent leads. The others build, in parallel.</h2>
          <p className="section-lead">
            Give a Lead a feature. It reads the code, splits the work into tasks with acceptance criteria and hands each to the agent that
            does it best: Codex on the API, Claude on the UI, Gemini on the tests, each in its own worktree. Then it reviews every diff, sends
            work back when it falls short, and merges the good branches with your tests as the check.
          </p>
          <ul className="checks">
            <li><Check size={16} /> Agents from every vendor on one goal, not one vendor's model on everything</li>
            <li><Check size={16} /> <span>Agent <code>auto</code> routes each task to the agent that scored best on your evals</span></li>
            <li><Check size={16} /> Hard limits on workers, a review loop before anything is merged, and nothing pushed without your click</li>
          </ul>
          <p className="spot-more">
            <a className="more-link" href="/docs/lead">
              How a Lead works <ArrowRight size={15} />
            </a>
          </p>
        </div>
        <div className="code brand-frame failover lead-pane" ref={ref} role="img" aria-label="A Lead mission delegates three tasks to Codex, Claude Code and Gemini, sends one back after review, then merges all three with tests passing">
          <div className="code-h">Lead · Team invites · feature/team-invites</div>
          <pre key={seen}>
            <L i={0}><span className="t-purple">lead  </span>{'  Plan: 3 tasks, independent'}</L>
            <L i={1}><span className="t-purple">lead  </span>{'  → Invites API         '}<span className="t-blue">codex </span><span className="t-dim">{'  best on your evals 9/10'}</span></L>
            <L i={2}><span className="t-purple">lead  </span>{'  → Invite email UI     '}<span className="t-blue">claude</span></L>
            <L i={3}><span className="t-purple">lead  </span>{'  → Tests for invites   '}<span className="t-blue">gemini</span></L>
            <L i={4} />
            <L i={5}><span className="t-dim">codex </span>{'  '}<span className="t-green">{'✓'}</span>{' done · 4 files · +182 −12'}</L>
            <L i={6}><span className="t-purple">lead  </span>{'  Review: /invite has no rate limit '}<span className="t-amber">{'→ sent back'}</span></L>
            <L i={7}><span className="t-dim">claude</span>{'  '}<span className="t-green">{'✓'}</span>{' done · 3 files · +96 −4'}</L>
            <L i={8}><span className="t-dim">gemini</span>{'  '}<span className="t-green">{'✓'}</span>{' done · 2 files · +140'}</L>
            <L i={9}><span className="t-dim">codex </span>{'  '}<span className="t-green">{'✓'}</span>{' fixed · rate limit added'}</L>
            <L i={10} />
            <L i={11}><span className="t-purple">lead  </span>{'  Merged 3 branches · npm test '}<span className="t-green">{'✓ 112 passed'}</span></L>
            <L i={12}><span className="t-green">{'●'}</span>{' Ready for your review · nothing pushed'}</L>
          </pre>
        </div>
      </div>
    </section>
  )
}

const columns: Array<{ title: string; note?: string; cards: Array<{ key: number; title: string; labels: string[]; by?: string; high?: boolean; state?: 'working' | 'review'; action?: string; issue?: number; waits?: number; spent?: string }> }> = [
  {
    title: 'Proposed',
    note: 'written by agents',
    cards: [
      { key: 14, title: 'Invite people by email', labels: ['feature'], by: 'claude', action: 'Approve' },
      { key: 15, title: 'Owners remove members', labels: ['feature', 'auth'], by: 'claude', action: 'Approve' }
    ]
  },
  {
    title: 'Agent ready',
    note: 'auto pick-up',
    cards: [
      { key: 9, title: 'Login button does nothing on Safari', labels: ['bug', 'p1'], high: true, issue: 42 },
      { key: 13, title: 'Create a team', labels: ['feature', 'api'] },
      { key: 16, title: 'Share a project with a team', labels: ['feature'], waits: 13 }
    ]
  },
  { title: 'In progress', cards: [{ key: 11, title: 'Rate-limit the public API', labels: ['api'], state: 'working' }] },
  { title: 'Review', cards: [{ key: 8, title: 'Dark mode toggle', labels: ['ui'], state: 'review', spent: '14 min · 3 agents · $1.84' }] }
]

/** The work board: agents write stories into Proposed, you approve, the factory picks them up. */
export function BoardSpotlight() {
  return (
    <section className="section alt" id="board">
      <div className="container">
        <div className="section-head">
          <div>
            <p className="eyebrow">The Board · new</p>
            <h2>Describe a feature. Agents write the stories and pick them up.</h2>
            <p className="section-lead">
              A board made for agents. One reads your code and splits a feature into well-defined stories: why, what to change, acceptance
              criteria, how to check. You approve them, and the factory takes Agent ready cards on its own, follows each run to Review, and
              moves the card to Done when its pull request is merged.
            </p>
          </div>
          <a className="more-link" href="/docs/board">
            How the Board works <ArrowRight size={15} />
          </a>
        </div>
        <div className="mboard" role="img" aria-label="A board with Proposed, Agent ready, In progress and Review columns. Stories written by Claude wait for approval; a GitHub issue is Agent ready with high priority.">
          {columns.map((c) => (
            <div className="mboard-col" key={c.title}>
              <div className="mboard-head">
                {c.title}
                {c.note && <span className="mboard-note">{c.note}</span>}
              </div>
              {c.cards.map((k) => (
                <div className={`mboard-card${k.state ? ` ${k.state}` : ''}`} key={k.key}>
                  <div className="mboard-meta">
                    <span>#{k.key}</span>
                    {k.issue && <span className="mboard-chip"><CircleDot size={10} /> {k.issue}</span>}
                    {k.high && <ArrowUp size={11} className="t-amber" />}
                    {k.by && <span className="mboard-chip"><Sparkles size={10} /> {k.by}</span>}
                  </div>
                  <div className="mboard-title">{k.title}</div>
                  <div className="mboard-labels">{k.labels.map((l) => <span key={l}>{l}</span>)}</div>
                  {k.waits && <div className="mboard-waits"><Hourglass size={11} /> Waits for #{k.waits}</div>}
                  {k.spent && <div className="mboard-spent">{k.spent}</div>}
                  {k.action && <div className="mboard-action"><Check size={11} /> {k.action}</div>}
                  {k.state === 'working' && <div className="mboard-state"><span className="dot ready" /> Codex · Build · 2/4 stages</div>}
                  {k.state === 'review' && <div className="mboard-state"><span className="dot working" /> PR #12 · waiting for review</div>}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="ctx-points">
          <div>
            <h3>Stories, not vague tickets</h3>
            <p>Write stories or Refine with an agent turns "Login is slow" into a card an agent can pick up without asking. Agents also file follow-up work they find, and everything they write waits for you in Proposed.</p>
          </div>
          <div>
            <h3>Pick-up you control</h3>
            <p>Highest priority first, as many at once as you choose, as a factory recipe or a mission. Only while the app is open, and a pull request still waits for your click.</p>
          </div>
          <div>
            <h3>GitHub in, merged out</h3>
            <p>Import open issues with their labels (P1 comes in as high priority). A card's pull request closes its issue, and a merged PR moves the card to Done.</p>
          </div>
          <div>
            <h3>In the right order</h3>
            <p>A card waits for the cards it depends on; pick-up starts it the moment they are Done. Agents writing stories set the order themselves.</p>
          </div>
          <div>
            <h3>Costed, described, shipped</h3>
            <p>Every finished card shows its time, agents and token cost. Copy as PR description writes the pull request from the story; release notes come from Done.</p>
          </div>
          <div>
            <h3>Learns, and shared</h3>
            <p>A retro saves what went wrong as lessons in the project memory for the next agent. Keep the board in git and your team works from the same one.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

const leaderboard = [
  { who: 'Codex', rate: 0.9, checks: '96%', time: '3.2 min', diff: '84 lines' },
  { who: 'Claude Code · opus', rate: 0.8, checks: '93%', time: '4.1 min', diff: '61 lines' },
  { who: 'Gemini CLI', rate: 0.6, checks: '81%', time: '2.7 min', diff: '120 lines' }
]

/** Evals: which agent is best on your code, measured, and the numbers the Lead routes by. */
export function EvalsSpotlight() {
  return (
    <section className="section" id="evals">
      <div className="container split reverse">
        <div className="code brand-frame evals-mock" role="img" aria-label="An eval leaderboard: Codex passes 90%, Claude Code 80%, Gemini CLI 60%, with checks passed, median time and diff size">
          <div className="code-h"><Trophy size={12} /> Example leaderboard · 10 evals × 3 attempts</div>
          <div className="evals-mock-table">
          <table>
            <thead>
              <tr><th>Agent</th><th>Pass rate</th><th>Checks</th><th>Time</th><th>Diff</th></tr>
            </thead>
            <tbody>
              {leaderboard.map((r, i) => (
                <tr key={r.who} className={i === 0 ? 'top' : undefined}>
                  <td>{r.who}</td>
                  <td>
                    <span className="evals-bar"><span style={{ width: `${r.rate * 100}%` }} /></span> {Math.round(r.rate * 100)}%
                  </td>
                  <td>{r.checks}</td>
                  <td>{r.time}</td>
                  <td>{r.diff}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <pre className="evals-yaml">{`# .sldev/evals/leap-years.yml
name: Leap years
brief: parseDate must accept Feb 29 in leap years.
checks:
  - run: npm test
  - diff: 80
  - judge: Adds a test for 2024-02-29.`}</pre>
        </div>
        <div>
          <p className="eyebrow">Evals · new</p>
          <h2>Which agent is best on your code? Stop guessing.</h2>
          <p className="section-lead">
            Benchmarks measure someone else's code. An eval is a task from your repository with checks: tests that must pass, output it must
            print, a limit on the diff, or a judge agent with a rubric. Run a suite against any agents and models, each attempt in its own
            worktree, and see who passes most, fastest, with the smallest diff.
          </p>
          <ul className="checks">
            <li><Check size={16} /> Small YAML files next to your code, committed with it</li>
            <li><Check size={16} /> Save as eval turns a task you already gave an agent into one</li>
            <li><Check size={16} /> <span>The leaderboard is the routing table: a Lead's <code>auto</code> picks the winner</span></li>
          </ul>
          <p className="spot-more">
            <a className="more-link" href="/docs/evals">
              Write your first eval <ArrowRight size={15} />
            </a>
          </p>
        </div>
      </div>
    </section>
  )
}

const roles: Array<{ role: string; task: string; agent: string; state: 'done' | 'working' | 'back' | 'waits'; why?: string }> = [
  { role: 'Product owner', task: 'Writes 3 stories', agent: 'claude', state: 'done' },
  { role: 'Implementer', task: 'Invites API', agent: 'codex', state: 'done', why: 'best on Implementer evals' },
  { role: 'Implementer', task: 'Invite email UI', agent: 'claude', state: 'done' },
  { role: 'Reviewer', task: 'Review the API', agent: 'gemini', state: 'back', why: 'pinned in reviewer.md' },
  { role: 'QA', task: 'e2e for invites', agent: 'claude', state: 'working' },
  { role: 'Release manager', task: 'PR description', agent: 'codex', state: 'waits' }
]

const roleState = { done: ['t-green', '✓ done'], working: ['t-green', '● working'], back: ['t-amber', '↩ sent back'], waits: ['t-dim', '… waits'] } as const

/** Teams: a software org of agent profiles (one Markdown file per role), led by a Lead, routed by evals, overseen by you. */
export function TeamsSpotlight() {
  const [ref, seen] = useSeen<HTMLDivElement>()
  return (
    <section className="section alt" id="teams">
      <div className="container split">
        <div>
          <p className="eyebrow">Teams · new</p>
          <h2>Hire a software team. Every role is an agent.</h2>
          <p className="section-lead">
            Add a team in one click: a product owner, tech lead, implementer, reviewer, QA and release manager, each a Markdown file in your
            repo you can read, edit and commit. A Lead hands work to roles, your evals pick the best agent for each role, and the card shows
            who did what and what it cost.
          </p>
          <ul className="checks">
            <li><Check size={16} /> Any agent in any role: Claude reviews, Codex builds, Gemini tests, or the other way round</li>
            <li><Check size={16} /> <span>Tag an eval with a <code>role</code> and that role goes to the agent that wins it</span></li>
            <li><Check size={16} /> A team, not a zero-human company: you approve the stories, review the branch and push</li>
          </ul>
          <p className="spot-more">
            <a className="more-link" href="/docs/teams">
              Set up a team <ArrowRight size={15} />
            </a>
          </p>
        </div>
        <div className="code brand-frame org-mock" ref={ref} role="img" aria-label="An org chart: a Tech lead delegates to a Product owner, two Implementers, a Reviewer, QA and Release manager, each on a different agent; you approve, review and push">
          <div className="code-h">Lead · Team invites · Software team</div>
          <div className="org" key={seen}>
            <div className="org-node org-lead ln-svg" style={{ '--i': 0 } as React.CSSProperties}>
              <span className="org-role">Tech lead</span>
              <span className="org-meta"><span className="t-purple">claude</span> · plans and delegates</span>
            </div>
            <div className="org-roles">
              {roles.map((r, i) => {
                const [tone, label] = roleState[r.state]
                return (
                  <div className="org-node ln-svg" key={r.role + r.task} style={{ '--i': i + 1 } as React.CSSProperties}>
                    <span className="org-role">{r.role}</span>
                    <span className="org-task">{r.task}</span>
                    <span className="org-meta">
                      <span className="t-blue">{r.agent}</span> <span className={tone}>{label}</span>
                    </span>
                    {r.why && <span className="org-why">{r.why}</span>}
                  </div>
                )
              })}
            </div>
            <div className="org-you ln-svg" style={{ '--i': roles.length + 1 } as React.CSSProperties}>
              <span>You</span>
              <span className="art-chip">approve stories</span>
              <span className="art-chip">review the branch</span>
              <span className="art-chip">push</span>
            </div>
            <div className="org-spent ln-svg" style={{ '--i': roles.length + 2 } as React.CSSProperties}>
              Spent · 22 min · 7 agents · $2.41
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
