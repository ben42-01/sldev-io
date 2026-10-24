import { DownloadSection } from './components/Download'
import { Features } from './components/Features'
import { FinalCta, Footer } from './components/Footer'
import { AgentStrip, Hero } from './components/Hero'
import { Nav } from './components/Nav'
import { FaqSection, Pricing } from './components/Pricing'
import { Spotlight } from './components/Spotlight'
import { MakerNote, WhySection } from './components/Story'

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <AgentStrip />
        <WhySection />
        <Features />
        <Spotlight />
        <MakerNote />
        <Pricing />
        <DownloadSection />
        <FaqSection />
        <FinalCta />
      </main>
      <Footer />
    </>
  )
}
