import { FinalCta, Footer } from './components/Footer'
import { FreeBand, Loop, Shift } from './components/Flagship'
import { Hero } from './components/Hero'
import { Bento, ProofBand, Showcase } from './components/Home'
import { Nav } from './components/Nav'
import { TeamsSpotlight } from './components/Team'
import { HomeFaq } from './components/Faq'

/**
 * The home page makes one argument: writing code got cheap, deciding what ships didn't (the shift), so you
 * lead a team of agents through one loop (plan, build, review, prove), in one window, free and open source.
 * The deep dives on each feature live on /features.
 */
/** /app: the sldev-io desktop app's landing page (the site's home page until sldev became a family). */
export function AppLanding() {
  return (
    <>
      <Nav active="app" />
      <main>
        <Hero />
        <ProofBand />
        <Shift />
        <Loop />
        <TeamsSpotlight />
        <Showcase />
        <Bento />
        <FreeBand />
        <HomeFaq />
        <FinalCta install />
      </main>
      <Footer />
    </>
  )
}
