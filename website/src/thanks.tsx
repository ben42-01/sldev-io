import { createRoot } from 'react-dom/client'
import { DownloadButton } from './components/Download'
import { Footer } from './components/Footer'
import { Nav } from './components/Nav'
import { site } from './lib/pricing'
import './fonts'
import './styles.css'

/** Where Polar sends buyers after checkout (the checkout links' success URL). */
function Thanks() {
  return (
    <>
      <Nav />
      <main className="legal">
        <div className="container legal-inner">
          <p className="eyebrow">Order complete</p>
          <h1>Thanks for buying sldev-io</h1>
          <p className="legal-summary">Your license key is on its way by email. Here's how to use it.</p>
          <article className="legal-body">
            <ol className="thanks-steps">
              <li>
                <b>Find your key</b> in the receipt email from Polar, our payment provider. It starts with <code>SLDEV</code>. Not there
                after a few minutes? Check your spam folder.
              </li>
              <li>
                <b>Open sldev-io</b>, or download it below if you haven't yet.
              </li>
              <li>
                Go to <b>Settings → License</b> (or press <code>Ctrl+Shift+P</code>, <code>Cmd+Shift+P</code> on a Mac, and choose <b>Enter license key</b>), paste the key
                and choose <b>Activate</b>.
              </li>
            </ol>
            <p>
              A Personal license works on up to {site.legal.personalMachines} of your machines. Moving to a new one? Choose{' '}
              <b>Deactivate this machine</b> on the old one first.
            </p>
            <div className="hero-cta thanks-cta">
              <DownloadButton />
            </div>
            <p>
              Questions, or no email after an hour? Write to <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a> and include
              the email address you bought with.
            </p>
          </article>
        </div>
      </main>
      <Footer />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Thanks />)
