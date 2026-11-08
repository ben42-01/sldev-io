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

/** Everything around the loop, as cards of different sizes, each with a small picture of what it does. */
export function Bento() {
  return (
    <section className="section alt" id="features">
      <div className="container">
        <div className="section-head">
          <div>
            <p className="eyebrow">And everything around it</p>
            <h2>What one vendor's agent app can't do.</h2>
            <p className="section-lead">Your agents keep working when one runs out, share what they learn, and follow your process, on your machine.</p>
          </div>
          <a className="more-link" href="/features">
            All features <ArrowRight size={15} />
          </a>
        </div>
        <div className="bento">
          <a className="bento-card wide" href="/docs/missions#limits" style={{ '--glow': '#f5a52422' } as React.CSSProperties}>
            <h3>Never wait for a limit reset</h3>
            <p>When Claude stops at its plan's usage limit, Codex picks up the same task in the same folder, with the notes and the last output. The work finishes instead of waiting hours.</p>
            <div className="bento-art art-row" aria-hidden="true">
              <span className="art-chip dim">Claude · limit</span>
              <span className="art-arrow">→</span>
              <span className="art-chip">Codex continues</span>
              <span className="art-arrow">→</span>
              <span className="art-chip">✓ tests pass</span>
            </div>
          </a>
          <a className="bento-card wide" href="/docs/context" style={{ '--glow': '#a970ff22' } as React.CSSProperties}>
            <h3>One memory for every agent</h3>
            <p>What Claude learned this morning, Codex knows this afternoon. Notes are linked to the files they are about and flagged when the code moves on. Plain Markdown in your repo.</p>
            <div className="bento-art art-row" aria-hidden="true">
              <span className="art-chip">.sldev/memory.md</span><span className="art-chip dim">context/</span><span className="art-chip dim">pinned files</span>
            </div>
          </a>
          <a className="bento-card" href="/docs/recipes">
            <h3>Software Factory</h3>
            <p>Your process as a recipe: agent steps, checks and your approvals, from an issue to a reviewed PR.</p>
            <div className="bento-art art-row" aria-hidden="true">
              <span className="art-chip">spec</span><span className="art-arrow">→</span><span className="art-chip">build</span><span className="art-arrow">→</span><span className="art-chip">test</span><span className="art-arrow">→</span><span className="art-chip">PR</span>
            </div>
          </a>
          <a className="bento-card" href="/docs/missions">
            <h3>Mission Control</h3>
            <p>Every agent's status in one place, and one ping when one of them needs you.</p>
            <div className="bento-art art-status" aria-hidden="true">
              <span><i className="w" /> Codex · working</span>
              <span><i className="a" /> Claude · needs you</span>
              <span><i className="r" /> Gemini · ready for review</span>
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
