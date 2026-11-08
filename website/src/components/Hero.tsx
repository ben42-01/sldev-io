import { ArrowRight } from 'lucide-react'
import { betaMessage, betaStatus, formatPrice, pricing, site } from '../lib/pricing'
import { TeamGraph } from './TeamGraph'
import { DownloadButton } from './Download'

export function Hero() {
  const personal = pricing.plans.find((p) => p.id === 'personal') ?? pricing.plans[0]
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
          Stop babysitting agents in nine terminal tabs. Claude Code, Codex, Gemini and the rest plan, build and review together, each in
          its own worktree, on your machine. You decide what gets built and what ships.
        </p>
        <div className="hero-cta">
          <DownloadButton />
          <a className="btn lg" href="#how">
            See how it works
          </a>
        </div>
        <p className="platforms">
          Free for 14 days · then {formatPrice(personal.price)} once, no subscription · <a href="/download">{site.platforms.join(' · ')}</a>
        </p>
        <TeamGraph />
        <p className="tg-caption">A Lead mission, replayed. Pick another goal to watch it again.</p>
      </div>
    </section>
  )
}
