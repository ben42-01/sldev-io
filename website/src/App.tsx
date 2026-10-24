import { Features } from './components/Features'
import { FinalCta, Footer } from './components/Footer'
import { AgentStrip, Hero } from './components/Hero'
import { Nav } from './components/Nav'
import { FaqSection, Pricing } from './components/Pricing'
import { Spotlight } from './components/Spotlight'

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <AgentStrip />
        <Features />
        <Spotlight />
        <Pricing />
        <FaqSection />
        <FinalCta />
      </main>
      <Footer />
    </>
  )
}
