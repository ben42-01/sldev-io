import { createRoot } from 'react-dom/client'
import { ChangelogList } from './components/Changelog'
import { CompareTable } from './components/Compare'
import { DocArticle, DocsIndex } from './components/Docs'
import { DownloadOptions } from './components/Download'
import { FeatureGrid } from './components/Features'
import { FinalCta } from './components/Footer'
import { Layout, PageHeader } from './components/Layout'
import { LegalPage } from './components/LegalPage'
import { FaqSection, PricingPlans } from './components/Pricing'
import { AgentAgnostic, HowItWorks } from './components/Spotlight'
import { Thanks } from './components/Thanks'
import { docs } from './content/docs'
import { legalPages, type LegalPageId } from './content/legal'
import { pricing, site } from './lib/pricing'
import './fonts'
import './styles.css'

/** Every page except the home page: <name>/index.html sets data-page="<name>". */
const pages: Record<string, { title: string; render: () => React.JSX.Element }> = {
  features: {
    title: 'Features',
    render: () => (
      <Layout page="features">
        <PageHeader
          eyebrow="Features"
          title={
            <>
              Everything around the agent,
              <br />
              <span className="brand-text">nothing in the way.</span>
            </>
          }
          lead="The terminal is the main surface. Everything else exists to launch, organise and watch what runs in it."
        />
        <FeatureGrid />
        <AgentAgnostic />
        <HowItWorks />
        <FinalCta />
      </Layout>
    )
  },
  pricing: {
    title: 'Pricing',
    render: () => (
      <Layout page="pricing">
        <PageHeader
          eyebrow="Pricing"
          title={
            <>
              Pay once. <span className="brand-text">Own it.</span>
            </>
          }
          lead={`No subscription, no seat meter. A single ${pricing.billing} payment per license, with every future update included.`}
        />
        <PricingPlans />
        <FaqSection />
      </Layout>
    )
  },
  download: {
    title: 'Download',
    render: () => (
      <Layout page="download">
        <PageHeader
          eyebrow="Download"
          title={
            <>
              Get <span className="brand-text">sldev-io</span>
            </>
          }
          lead={`Version ${site.version}, free during the beta. Pick your system, or install from a terminal.`}
        />
        <DownloadOptions />
      </Layout>
    )
  },
  compare: {
    title: 'sldev-io compared',
    render: () => (
      <Layout>
        <PageHeader
          eyebrow="Compare"
          title={
            <>
              Where <span className="brand-text">sldev-io</span> fits
            </>
          }
          lead="Next to your editor and your terminal, not instead of them. What each kind of tool does out of the box."
        />
        <CompareTable />
      </Layout>
    )
  },
  changelog: {
    title: 'Changelog',
    render: () => (
      <Layout>
        <PageHeader eyebrow="Changelog" title={<>What's <span className="brand-text">new</span></>} lead="Every release of sldev-io. The app shows the same notes after it updates." />
        <ChangelogList />
      </Layout>
    )
  },
  docs: {
    title: 'Docs',
    render: () => (
      <Layout page="docs">
        <PageHeader eyebrow="Docs" title={<>Guides for <span className="brand-text">sldev-io</span></>} lead="How to get more out of it, step by step." />
        <DocsIndex />
      </Layout>
    )
  },
  // /docs/<id> pages set data-page="docs-<id>"
  ...Object.fromEntries(
    docs.map((d) => [
      `docs-${d.id}`,
      {
        title: d.title,
        render: () => (
          <Layout page="docs">
            <DocArticle page={d} />
          </Layout>
        )
      }
    ])
  ),
  thanks: {
    title: 'Thanks for buying sldev-io',
    render: () => (
      <Layout>
        <Thanks />
      </Layout>
    )
  },
  ...Object.fromEntries(
    Object.values(legalPages).map((l) => [
      l.id,
      {
        title: l.title,
        render: () => (
          <Layout>
            <LegalPage id={l.id as LegalPageId} />
          </Layout>
        )
      }
    ])
  )
}

const root = document.getElementById('root')!
const page = pages[root.dataset.page!]
document.title = `${page.title} · ${site.name}`
createRoot(root).render(page.render())
