import { FeatureHighlights } from './components/Features'
import { FinalCta, Footer } from './components/Footer'
import { AgentStrip, Hero } from './components/Hero'
import { Nav } from './components/Nav'
import { HomeFaq } from './components/Pricing'
import { WhySection } from './components/Story'

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <AgentStrip />
        <WhySection />
        <FeatureHighlights />
        <HomeFaq />
        <FinalCta />
      </main>
      <Footer />
    </>
  )
}
