import { ArrowRight, AppWindow, BookOpen, Heart, Lock, Puzzle, Star, SquareTerminal, Users } from 'lucide-react'
import { CopyCommand as CopyCli } from './cli/CopyCommand'
import cli from './cli/cli.json'
import data from './cli/cliHelp.json'
import { DownloadButton } from './components/Download'
import { Footer } from './components/Footer'
import { Nav } from './components/Nav'
import { site } from './lib/site'

const SKILLS_INSTALL = 'npx skills add ben42-01/downloads.sldev.io'

const SHARED = [
  { icon: Users, title: 'Every agent', text: `${site.agents.slice(0, -1).join(', ')}, or any CLI you add. Your own logins and plans, never a new subscription.` },
  { icon: Lock, title: 'On your machine', text: 'No account, no telemetry, no cloud in between. Your code, terminals and credentials stay where they are.' },
  { icon: BookOpen, title: 'One project format', text: 'Rules, memory and skills live in your repo, so the app, the CLI and your agents all read the same files.' }
]

/** The sldev home page: what sldev is, and one card per product. Each product has its own page (/app, /cli). */
export function App() {
  return (
    <>
      <Nav />
      <main>
        <section className="hero" id="top">
          <div className="hero-glow" aria-hidden="true" />
          <div className="container hero-inner">
            <a className="pill" href={site.sourceUrl}>
              <span className="pill-dot" /> Free and open source · Apache-2.0 <ArrowRight size={12} />
            </a>
            <h1>
              Lead your coding agents,
              <br />
              <span className="brand-text">wherever you work.</span>
            </h1>
            <p className="lead">
              sldev runs Claude Code, Codex, Gemini and the rest side by side, each in its own worktree, on your machine. A desktop
              app when you want the whole team in view, a CLI when you live in the terminal, and skills any agent can use.
            </p>
            <div className="hero-cta">
              <a className="btn primary lg" href={site.sourceUrl}>
                <Star size={16} /> Star on GitHub
              </a>
              <a className="btn lg" href="#products">
                Pick your tool
              </a>
            </div>
          </div>
        </section>

        <section className="section products-section" id="products" aria-labelledby="products-h">
          <div className="container">
            <p className="eyebrow center">The sldev family</p>
            <h2 id="products-h" className="center">
              One way of working, <span className="brand-text">three ways in.</span>
            </h2>
            <div className="products">
              <article className="product brand-frame">
                <div className="product-head">
                  <AppWindow size={20} />
                  <span className="product-kind">Desktop app</span>
                  <span className="product-version">v{site.version}</span>
                </div>
                <h3>{site.name}</h3>
                <p>
                  A workspace for a team of agents: a Lead that delegates in parallel, a board they pick work from, evals on your own code,
                  and review by purpose before anything ships. Not an IDE.
                </p>
                <div className="product-cta">
                  <DownloadButton className="btn primary" size={15} />
                  <a className="more-link" href="/app">
                    Tour the app <ArrowRight size={15} />
                  </a>
                </div>
                <p className="product-note">{site.platforms.join(' · ')}</p>
              </article>

              <article className="product">
                <div className="product-head">
                  <SquareTerminal size={20} />
                  <span className="product-kind">Command line</span>
                  <span className="product-version">v{data.version}</span>
                </div>
                <h3>sldev CLI</h3>
                <p>{cli.tagline} Tabs for every agent, a marker for the one that needs you, and agents that keep running when you close the terminal.</p>
                <div className="product-cta product-cta-cmd">
                  <CopyCli command={cli.install} label="install command" />
                  <a className="more-link" href="/cli">
                    See the CLI <ArrowRight size={15} />
                  </a>
                </div>
                <p className="product-note">{cli.requires}</p>
              </article>

              <article className="product">
                <div className="product-head">
                  <Puzzle size={20} />
                  <span className="product-kind">Agent skills</span>
                  <span className="product-soon">Catalog soon</span>
                </div>
                <h3>sldev skills</h3>
                <p>
                  Plain SKILL.md folders any agent can run: draft a mission, write board stories, build a factory recipe or an eval, then
                  hand it to the app or the CLI.
                </p>
                <div className="product-cta product-cta-cmd">
                  <CopyCli command={SKILLS_INSTALL} label="skills install command" />
                  <a className="more-link" href="/docs/missions#skills">
                    How they work <ArrowRight size={15} />
                  </a>
                </div>
                <p className="product-note">sldev-mission · sldev-stories · sldev-recipe · sldev-eval</p>
              </article>
            </div>
          </div>
        </section>

        <section className="section alt" aria-labelledby="shared-h">
          <div className="container">
            <p className="eyebrow center">Whichever you pick</p>
            <h2 id="shared-h" className="center">Same agents, same rules, same repo.</h2>
            <div className="grid">
              {SHARED.map(({ icon: Icon, title, text }) => (
                <div className="card" key={title}>
                  <Icon size={20} />
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section final">
          <div className="container center">
            <h2>
              Built in the open.
              <br />
              <span className="brand-text">Kept going by people who use it.</span>
            </h2>
            <p className="section-lead center">
              Everything sldev makes is free. A star helps other developers find it; a sponsorship keeps the work going. Neither unlocks
              anything: everyone gets the same tools.
            </p>
            <div className="hero-cta">
              <a className="btn primary lg" href={site.sourceUrl}>
                <Star size={16} /> Star on GitHub
              </a>
              <a className="btn lg" href={site.sponsorUrl}>
                <Heart size={16} /> Sponsor
              </a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
