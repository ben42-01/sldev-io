import { ContextSpotlight } from './components/ContextSpotlight'
import { FailoverSpotlight } from './components/Failover'
import { FeatureHighlights } from './components/Features'
import { FinalCta, Footer } from './components/Footer'
import { AgentStrip, Hero } from './components/Hero'
import { Nav } from './components/Nav'
import { HomeFaq } from './components/Pricing'
import { WhySection } from './components/Story'
import { WorkflowsSpotlight } from './components/Workflows'
import { BoardSpotlight, EvalsSpotlight, LeadSpotlight } from './components/Team'

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <AgentStrip />
        <WhySection />
        <LeadSpotlight />
        <BoardSpotlight />
        <EvalsSpotlight />
        <FailoverSpotlight />
        <ContextSpotlight />
        <FeatureHighlights />
        <WorkflowsSpotlight />
        <HomeFaq />
        <FinalCta />
      </main>
      <Footer />
    </>
  )
}
