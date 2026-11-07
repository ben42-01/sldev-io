import { ContextSpotlight } from './components/ContextSpotlight'
import { FailoverSpotlight } from './components/Failover'
import { FinalCta, Footer } from './components/Footer'
import { Hero } from './components/Hero'
import { Bento, FlowSteps, ProofBand, Showcase } from './components/Home'
import { Nav } from './components/Nav'
import { HomeFaq } from './components/Pricing'
import { WhySection } from './components/Story'
import { BoardSpotlight, EvalsSpotlight, LeadSpotlight } from './components/Team'

/** The home page tells one story: the team at work (hero), how a feature ships, each part of it, then everything else. */
export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <ProofBand />
        <FlowSteps />
        <BoardSpotlight />
        <LeadSpotlight />
        <EvalsSpotlight />
        <WhySection />
        <Bento />
        <FailoverSpotlight />
        <ContextSpotlight />
        <Showcase />
        <HomeFaq />
        <FinalCta install />
      </main>
      <Footer />
    </>
  )
}
