import { ArrowRight, Lock } from 'lucide-react'
import { AppShowcase } from './AppMockup'
import { site } from '../lib/pricing'

/** Numbers that set it apart, and the agents it runs, right under the hero. */
export function ProofBand() {
  const stats = [
    { n: '6+', t: 'agent CLIs built in, and any other you add' },
    { n: '0', t: 'telemetry. Your code goes only to the agent you chose' },
    { n: '1', t: 'payment. No subscription, every update included' },
    { n: 'Local', t: 'with your databases, Docker, secrets and tools' }
  ]
  return (
    <section className="proof" aria-label="At a glance">
      <div className="container">
        <div className="proof-inner">
          {stats.map((s) => (
            <div className="proof-item" key={s.n}>
              <b className={s.n === '0' ? 'brand-text' : undefined}>{s.n}</b>
              <span>{s.t}</span>
            </div>
          ))}
        </div>
        <ul className="proof-agents" aria-label="Supported agents">
          {site.agents.map((a) => <li key={a}>{a}</li>)}
        </ul>
      </div>
    </section>
  )
}

const steps = [
  { n: '01', title: 'Describe it', text: 'Put a feature on the Board. An agent reads your code and writes it up as stories with acceptance criteria.', who: 'an agent', href: '#board' },
  { n: '02', title: 'Approve it', text: 'Read the stories, edit what you like, approve them. Nothing reaches an agent before you say so.', who: 'you', href: '#board' },
  { n: '03', title: 'Delegate it', text: 'A Lead hands the parts to Claude, Codex, Gemini or any agent, each in its own worktree, routed by your evals.', who: 'a Lead and its team', href: '#lead' },
  { n: '04', title: 'Verify and ship', text: 'Diffs are reviewed against the criteria, sent back when short, merged with your tests. You click to push.', who: 'your tests, then you', href: '#evals' }
]

/** The story of a feature, from idea to pull request, linking to each part below. */
export function FlowSteps() {
  return (
    <section className="section flow-section" id="how">
      <div className="container">
        <div className="section-head">
          <div>
            <p className="eyebrow">How a feature ships</p>
            <h2>From an idea to a reviewed pull request, with a team of agents.</h2>
            <p className="section-lead">You decide what gets built and what ships. The agents do everything in between, in parallel, on your machine.</p>
          </div>
        </div>
        <div className="flow">
          {steps.map((s) => (
            <a className="flow-step" href={s.href} key={s.n}>
              <span className="flow-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <span className={`flow-who${s.who === 'you' ? ' you' : ''}`}>{s.who}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}

/** The highlights as cards of different sizes, each with a small picture of what it does. */
export function Bento() {
  return (
    <section className="section alt" id="features">
      <div className="container">
        <div className="section-head">
          <div>
            <p className="eyebrow">Features</p>
            <h2>What one vendor's agent app can't do.</h2>
            <p className="section-lead">Agents write the code. sldev-io makes agents from every vendor work as one team, measures who's best at what, and keeps you in charge.</p>
          </div>
          <a className="more-link" href="/features">
            All features <ArrowRight size={15} />
          </a>
        </div>
        <div className="bento">
          <a className="bento-card wide" href="/docs/lead" style={{ '--glow': '#a970ff26' } as React.CSSProperties}>
            <span className="bento-tag">new</span>
            <h3>Lead missions</h3>
            <p>One agent plans and delegates; the others build in parallel, each in its own worktree. It reviews, sends back, merges.</p>
            <div className="bento-art art-tree" aria-hidden="true">
              <div className="top"><i className="p" /> Lead · Team invites</div>
              <div className="indent"><i /> Codex · Invites API · merged</div>
              <div className="indent"><i /> Claude Code · Invite UI · merged</div>
              <div className="indent"><i className="b" /> Gemini CLI · Tests · working</div>
            </div>
          </a>
          <a className="bento-card wide" href="/docs/missions#review" style={{ '--glow': '#2ee6a81f' } as React.CSSProperties}>
            <span className="bento-tag">new</span>
            <h3>Review by purpose, not by file</h3>
            <p>Each part of the change says why it's there and whether anyone asked for it. Noise is folded, overengineering shows up before you read a line.</p>
            <div className="bento-art art-review" aria-hidden="true">
              <div className="bar"><i className="a" style={{ flexGrow: 4 }} /><i className="x" style={{ flexGrow: 2 }} /><i className="n" style={{ flexGrow: 5 }} /></div>
              <div><b className="a" /> Rate limit on /invite <em>asked for · ✓ looks good</em></div>
              <div><b className="x" /> A cache layer for later <em>not asked for · cut it</em></div>
              <div className="dim"><b /> 640 lines of noise <em>folded</em></div>
            </div>
          </a>
          <a className="bento-card" href="/docs/evals" style={{ '--glow': '#2ee6a822' } as React.CSSProperties}>
            <span className="bento-tag">new</span>
            <h3>Evals on your code</h3>
            <p>Which agent, model and prompt does your work best, measured with your tests.</p>
            <div className="bento-art art-bars" aria-hidden="true">
              <div>Codex<i><b style={{ width: '90%' }} /></i>90%</div>
              <div>Claude Code<i><b style={{ width: '80%' }} /></i>80%</div>
              <div>Gemini CLI<i><b style={{ width: '60%' }} /></i>60%</div>
            </div>
          </a>
          <a className="bento-card" href="/docs/board">
            <span className="bento-tag">new</span>
            <h3>A board agents work from</h3>
            <p>Agents write the stories in order, you approve, pick-up does the rest. Every card shows what it cost.</p>
            <div className="bento-art art-cols" aria-hidden="true">
              <div><em>proposed</em><span /><span /></div>
              <div><em>ready</em><span /><span /></div>
              <div><em>doing</em><span className="hot" /></div>
              <div><em>done</em><span className="ok" /><span className="ok" /></div>
            </div>
          </a>
          <a className="bento-card" href="/docs/recipes">
            <h3>Software Factory</h3>
            <p>Recipes from an issue to a reviewed PR: agent steps, checks and your approvals.</p>
            <div className="bento-art art-row" aria-hidden="true">
              <span className="art-chip">spec</span><span className="art-arrow">→</span><span className="art-chip">build</span><span className="art-arrow">→</span><span className="art-chip">test</span><span className="art-arrow">→</span><span className="art-chip">PR</span>
            </div>
          </a>
          <a className="bento-card" href="/docs/context">
            <h3>One memory for every agent</h3>
            <p>What Claude learned this morning, Codex knows this afternoon. Plain Markdown in your repo.</p>
            <div className="bento-art art-row" aria-hidden="true">
              <span className="art-chip">.sldev/memory.md</span><span className="art-chip dim">context/</span>
            </div>
          </a>
          <a className="bento-card" href="/docs/missions#limits" style={{ '--glow': '#f5a52422' } as React.CSSProperties}>
            <h3>Continues at the usage limit</h3>
            <p>When one agent stops at its plan's limit, the next one in your order picks up the same task in the same folder.</p>
            <div className="bento-art art-row" aria-hidden="true">
              <span className="art-chip dim">Claude Code · limit reached</span>
              <span className="art-arrow">→</span>
              <span className="art-chip">Codex continues</span>
              <span className="art-arrow">→</span>
              <span className="art-chip">✓ tests pass</span>
            </div>
          </a>
          <a className="bento-card" href="/privacy">
            <h3>Yours, on your machine</h3>
            <p>No telemetry, no extra cloud. Secrets stay in your OS keychain; nothing is pushed without your click.</p>
            <div className="bento-art art-lock" aria-hidden="true">
              <span className="art-chip"><Lock size={11} /> local</span><span className="art-chip dim">no telemetry</span>
            </div>
          </a>
        </div>
      </div>
    </section>
  )
}

/** The real app, in its own section now that the hero shows the team. */
export function Showcase() {
  return (
    <section className="section showcase" id="app">
      <div className="container">
        <div className="section-head">
          <div>
            <p className="eyebrow">The app</p>
            <h2>One window for every agent, terminal first.</h2>
            <p className="section-lead">Missions, factory runs and reviews next to real terminals. Not an IDE: your files still open in your own editor.</p>
          </div>
        </div>
        <div className="hero-shot">
          <AppShowcase />
        </div>
      </div>
    </section>
  )
}
