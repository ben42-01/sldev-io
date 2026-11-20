import { ArrowRight } from 'lucide-react'
import { site } from '../lib/site'
import { TeamGraph } from './TeamGraph'
import { DownloadButton } from './Download'

export function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero-glow" aria-hidden="true" />
      <div className="container hero-inner">
        <a className="pill" href={site.sourceUrl}>
          <span className="pill-dot" /> v{site.version} · free and open source
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
          Free and open source · <a href={site.sourceUrl}>Star on GitHub</a> · <a href="/download">{site.platforms.join(' · ')}</a>
        </p>
        <TeamGraph />
        <p className="tg-caption">A Lead mission, replayed. Pick another goal to watch it again.</p>
      </div>
    </section>
  )
}
