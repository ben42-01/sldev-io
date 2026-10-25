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
          <span className="pill-dot" /> v{site.version} · free during the beta
          {betaStatus().active && <span className="pill-limited">· {betaMessage().toLowerCase()}</span>}
          <ArrowRight size={12} />
        </a>
        <h1>
          Every coding agent.
          <br />
          <span className="brand-text">One workspace.</span>
        </h1>
        <p className="lead">
          Run Claude Code, Codex, Cursor Agent, Copilot, OpenCode and Gemini side by side, or chain them into a Software Factory
          that takes an idea from spec to reviewed pull request. You only step in where it matters.
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
