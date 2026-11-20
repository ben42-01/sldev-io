import { createRoot } from 'react-dom/client'
import { AppLanding } from './AppLanding'
import { CliHome } from './cli/CliHome'
import { CommandsPage } from './cli/CommandsPage'
import { ChangelogList } from './components/Changelog'
import { CompareTable } from './components/Compare'
import { DocArticle, DocsIndex } from './components/Docs'
import { DownloadOptions } from './components/Download'
import { FeatureGrid } from './components/Features'
import { FinalCta } from './components/Footer'
import { Layout, PageHeader } from './components/Layout'
import { LegalPage } from './components/LegalPage'
import { FaqSection } from './components/Faq'
import { AgentAgnostic, HowItWorks } from './components/Spotlight'
import { WorkflowsSpotlight } from './components/Workflows'
import { BoardSpotlight, EvalsSpotlight, LeadSpotlight } from './components/Team'
import { FailoverSpotlight } from './components/Failover'
import { ContextSpotlight } from './components/ContextSpotlight'
import { WhySection } from './components/Story'
import { docs } from './content/docs'
import { legalPages, type LegalPageId } from './content/legal'
import { site } from './lib/site'
import './fonts'
import './styles.css'
import './cli/cli.css'

/** Every page except the home page: <name>/index.html sets data-page="<name>". */
const pages: Record<string, { title: string; render: () => React.JSX.Element }> = {
  app: { title: `${site.name}, the desktop app`, render: () => <AppLanding /> },
  cli: { title: 'sldev CLI: every coding agent, side by side in your terminal', render: () => <CliHome /> },
  'cli-commands': { title: 'sldev CLI commands', render: () => <CommandsPage /> },
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
          lead="Agents from every vendor, working as one team on your machine: a Lead that delegates, a board they work from, evals that measure them, and everything around the terminal."
        />
        <FeatureGrid />
        <LeadSpotlight />
        <BoardSpotlight />
        <EvalsSpotlight />
        <WhySection />
        <FailoverSpotlight />
        <ContextSpotlight />
        <WorkflowsSpotlight />
        <AgentAgnostic />
        <HowItWorks />
        <FaqSection />
        <FinalCta />
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
          lead={`Version ${site.version}. Free and open source. Pick your system, or install from a terminal.`}
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
          lead="Next to your editor and your terminal, and on your machine instead of someone else's cloud. What each kind of tool does out of the box."
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
document.title = `${page.title} · ${site.brand}`
createRoot(root).render(page.render())
