import { ArrowRight } from 'lucide-react'
import { betaMessage, betaStatus, site } from '../lib/pricing'
import { AppShowcase } from './AppMockup'
import { DownloadButton } from './Download'

export function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-glow" aria-hidden="true" />
      <div className="container hero-inner">
        <a className="pill" href="/pricing">
          <span className="pill-dot" /> v{site.version} · free 14-day trial
          {betaStatus().active && <span className="pill-limited">· {betaMessage().toLowerCase()}</span>}
          <ArrowRight size={12} />
        </a>
        <h1>
          Every coding agent.
          <br />
          <span className="brand-text">Working as one team.</span>
        </h1>
        <p className="lead">
          Claude Code, Codex, Cursor Agent, Copilot, OpenCode and Gemini on your own machine, as one team. A Lead agent splits a feature and
          delegates the parts to the others in parallel, agents write the stories on your board and pick up what you approve, and evals
          on your own code show who does what best. Nothing is pushed without your click.
        </p>
        <div className="hero-cta">
          <DownloadButton />
          <a className="btn lg" href="/features">
            See how it works
          </a>
        </div>
        <p className="platforms">
          <a href="/download">{site.platforms.join(' · ')}</a> · one-time license, no subscription
        </p>
        <div className="hero-shot">
          <AppShowcase />
        </div>
      </div>
    </section>
  )
}

export function AgentStrip() {
  return (
    <section className="strip" id="agents" aria-label="Supported agents">
      <div className="container">
        <p className="eyebrow center">Works with the agents you already use</p>
        <ul className="strip-list">
          {site.agents.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
