import { FeatureHighlights } from './components/Features'
import { FinalCta, Footer } from './components/Footer'
import { AgentStrip, Hero } from './components/Hero'
import { Nav } from './components/Nav'
import { HowItWorks } from './components/Spotlight'
import { MakerNote, WhySection } from './components/Story'

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <AgentStrip />
        <WhySection />
        <FeatureHighlights />
        <HowItWorks />
        <MakerNote />
        <FinalCta />
      </main>
      <Footer />
    </>
  )
}
