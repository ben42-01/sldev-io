import { ArrowRight } from 'lucide-react'
import { betaMessage, betaStatus, site } from '../lib/pricing'
import { TeamGraph } from './TeamGraph'
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
          A Lead agent splits the work. Claude Code, Codex, Gemini and the rest build it in parallel, each in its own worktree. Your tests
          decide what gets merged, and you decide what ships. All on your own machine.
        </p>
        <div className="hero-cta">
          <DownloadButton />
          <a className="btn lg" href="#how">
            See how it works
          </a>
        </div>
        <p className="platforms">
          <a href="/download">{site.platforms.join(' · ')}</a> · one-time license, no subscription
        </p>
        <TeamGraph />
        <p className="tg-caption">A Lead mission, replayed. Pick another goal to watch it again.</p>
      </div>
    </section>
  )
}
