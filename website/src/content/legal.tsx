import type { ReactNode } from 'react'
import { site } from '../lib/pricing'

export type LegalPageId = 'terms' | 'privacy' | 'refunds'

export interface LegalPage {
  id: LegalPageId
  title: string
  summary: string
  body: ReactNode
}

const { legal } = site
const seller = legal.seller || '[seller name]'
const country = legal.country || '[country]'
const email = <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
const page = (id: LegalPageId, label: string): ReactNode => <a href={`/${id}`}>{label}</a>

function Contact(): ReactNode {
  return (
    <>
      <h2>Contact</h2>
      <p>
        {seller}
        <br />
        {legal.address && (
          <>
            {legal.address}
            <br />
          </>
        )}
        {email}
      </p>
    </>
  )
}

const terms: LegalPage = {
  id: 'terms',
  title: 'License terms and terms of sale',
  summary: `You pay once for a license to use sldev-io: one person, up to ${legal.personalMachines} machines, every future update included.`,
  body: (
    <>
      <h2>1. Who we are</h2>
      <p>
        sldev-io ("the software") is made and licensed by {seller} ("we", "us"). Purchases are processed by Polar Software Inc.
        ("Polar"), which acts as reseller and merchant of record: Polar takes the payment, charges any VAT or sales tax, and issues
        your receipt and invoice under its own terms.
      </p>

      <h2>2. The license</h2>
      <p>When you buy a license, you get a personal, non-exclusive, non-transferable right to install and use the software:</p>
      <ul>
        <li>
          <b>Personal</b>: one named person, on up to {legal.personalMachines} machines that person uses.
        </li>
        <li>
          <b>Team</b>: the number of people shown for the plan when you bought it, each on up to {legal.personalMachines} machines.
        </li>
      </ul>
      <p>
        You may use the software for personal and commercial work. A license is activated with a key. You can move it from a machine
        you no longer use to a new one.
      </p>

      <h2>3. Updates</h2>
      <p>
        A license includes every update we release, with no subscription and no renewal fee. We may change the price of new licenses
        at any time; that never affects a license you already bought.
      </p>

      <h2>4. Free beta</h2>
      <p>
        Beta versions are free for a limited time, shown on our website. When the beta ends, beta versions stop opening until you enter a
        license. Your data stays on your machine and is never deleted. Beta versions may contain bugs and change without notice.
      </p>

      <h2>5. What you may not do</h2>
      <ul>
        <li>Share, sell, rent or publish your license key, or let more people or machines use it than your plan allows.</li>
        <li>Remove or work around the license check, or distribute modified copies of the software.</li>
        <li>Reverse engineer the software, except where the law allows it regardless of this term.</li>
      </ul>

      <h2>6. Coding agents and other tools</h2>
      <p>
        sldev-io starts tools that are already on your machine, such as Claude Code, Codex, Cursor Agent, GitHub Copilot, git, the
        GitHub CLI, ssh and Docker. They are separate products, with their own terms, accounts and costs. Agents can change files and
        run commands in the folders you give them. Review their changes before you rely on them, and keep backups or use version
        control.
      </p>

      <h2>7. Warranty and liability</h2>
      <p>
        The software is provided "as is". We work to keep it reliable, but we don't promise it is free of errors or fit for a
        particular purpose. To the extent the law allows, our total liability for any claim about the software is limited to the
        amount you paid for your license, and we are not liable for indirect losses such as lost data, profits or business. Nothing in
        these terms limits rights you have as a consumer that cannot be limited by contract, or liability for death or personal injury
        caused by negligence, or for fraud.
      </p>

      <h2>8. Refunds</h2>
      <p>See the {page('refunds', 'refund policy')}: a full refund within 14 days of purchase.</p>

      <h2>9. Ending the license</h2>
      <p>
        The license ends automatically if you break these terms, or if your purchase is refunded or charged back. When it ends, you
        must stop using the software.
      </p>

      <h2>10. Changes and law</h2>
      <p>
        We may update these terms for future purchases and versions; the terms that applied when you bought keep applying to your
        license. These terms are governed by the laws of {country}. If you are a consumer, you also keep the protection of the
        mandatory laws of the country you live in.
      </p>

      <Contact />
    </>
  )
}

const privacy: LegalPage = {
  id: 'privacy',
  title: 'Privacy policy',
  summary: 'No account, no telemetry, no analytics. Your code, terminals, notes and credentials stay on your machine.',
  body: (
    <>
      <h2>Who is responsible</h2>
      <p>
        {seller} ("we") is responsible for the personal data described here. Questions or requests: {email}.
      </p>

      <h2>On your machine</h2>
      <p>
        sldev-io keeps its settings, layout, missions, notes and saved connections in its data folder on your computer (Settings →
        About → Open data folder). Passwords and keys you save are encrypted with your operating system's keychain. None of this is
        sent to us. To remove it, uninstall the app and delete that folder.
      </p>

      <h2>What the app sends over the network</h2>
      <p>The app has no telemetry: it never reports how you use it. It only makes these requests:</p>
      <ul>
        <li>
          <b>Beta check</b> (beta versions only): every few hours it downloads a small file with the beta dates from our website. Like
          any web request, this shows our hosting provider your IP address and app version.
        </li>
        <li>
          <b>Update check</b>: every few hours it asks GitHub, where our installers are hosted, whether a newer version exists, and
          downloads it if so. GitHub sees your IP address.
        </li>
        <li>
          <b>License activation</b>: when you enter a license key, and about every two weeks after, the app sends the key, a one-way
          hash of your machine's ID (we never see the ID itself), your operating system and processor type (for example "Linux x64", so
          you can tell your machines apart) and the app version to our license server, which checks the key with Polar. The server
          sends back a signed license with your plan and the email address you bought with, shown in Settings → License.
        </li>
      </ul>
      <p>
        The tools sldev-io starts for you, such as coding agents, git, the GitHub CLI, ssh and Docker, connect to their own services
        under their own privacy policies. sldev-io doesn't see or relay that traffic.
      </p>
      <p>
        Automations you set up to react to failed CI runs or labelled issues ask GitHub through your GitHub CLI every five minutes while
        they are switched on and the app is open. That goes from your computer to GitHub, signed in as you; nothing goes to us.
      </p>
      <p>
        The work board asks GitHub through your GitHub CLI for your open issues when you import them, and, while the app is open, about
        every five minutes whether the pull request of a card waiting for review was merged. Before a card's work starts, it runs git
        fetch against your branch's remote, so the work builds on pull requests that were already merged. That goes from your computer
        to GitHub (or wherever your remote is), signed in as you; nothing goes to us.
      </p>
      <p>
        The free sldev CLI makes no network requests of its own. Its workflows view (<code>sldev workflows</code>, or Ctrl-b w when
        attached) asks GitHub for your repository's recent workflow runs through your GitHub CLI when you open it, and every 15 seconds
        while it stays open; rerunning a run or opening it in the browser goes the same way. Nothing goes to us.
      </p>
      <p>
        Remote connections you open (SSH sessions, and Ping, which only checks that a saved host's SSH port answers) go straight from
        your computer to that host and nowhere else.
      </p>

      <h2>This website</h2>
      <p>
        No cookies, no analytics and no tracking. Fonts are served from this site. Our hosting provider keeps standard request logs (IP
        address, browser, page) for a short time for security. Download buttons send you to GitHub, which hosts the installers.
      </p>

      <h2>When you buy</h2>
      <p>
        Polar, our merchant of record, collects your name, email address, billing country and payment details to process the order,
        and pays through Stripe. We receive your name, email address, order details and license key status, and use them to deliver and
        support your license and to keep the records tax law requires. Card details never reach us.
      </p>

      <h2>Legal basis and retention</h2>
      <ul>
        <li>Purchase and license data: to perform our contract with you; kept as long as tax law requires (up to 10 years).</li>
        <li>Request logs and license checks: our legitimate interest in running a secure service; logs are kept for a short time.</li>
      </ul>

      <h2>Service providers</h2>
      <ul>
        <li>Vercel Inc. (website, beta file and license server hosting)</li>
        <li>GitHub Inc. (installer and update hosting)</li>
        <li>Polar Software Inc. (payments, invoices and license keys), and Stripe, which processes payments for Polar</li>
      </ul>
      <p>Some of these providers process data in the United States, under safeguards such as the EU Standard Contractual Clauses.</p>

      <h2>Your rights</h2>
      <p>
        You can ask for a copy of your data, its correction or deletion, or object to its use, by writing to {email}. You can also
        complain to your data protection authority.
      </p>

      <h2>Changes</h2>
      <p>If the app starts sending anything new, this page changes first, and the date below changes with it.</p>

      <Contact />
    </>
  )
}

const refunds: LegalPage = {
  id: 'refunds',
  title: 'Refund policy',
  summary: 'Not for you? Ask within 14 days of buying and you get your money back, no questions asked.',
  body: (
    <>
      <h2>14-day refund</h2>
      <p>
        If sldev-io isn't right for you, ask for a refund within 14 days of your purchase and you get the full amount back, no questions
        asked. Reply to your Polar receipt email, or write to {email} from the address you bought with.
      </p>

      <h2>What happens to the license</h2>
      <p>
        A refunded license key is deactivated. The app asks for a license again the next time it checks, at most a few weeks later.
        Your data stays on your machine.
      </p>

      <h2>After 14 days</h2>
      <p>
        Write to us anyway if something is wrong, for example if the software doesn't work on your system and we can't fix it. We
        decide case by case.
      </p>

      <h2>Your legal rights</h2>
      <p>
        This policy adds to, and doesn't replace, rights you have by law. Polar, as merchant of record, issues the refund to your
        original payment method.
      </p>

      <Contact />
    </>
  )
}

export const legalPages: Record<LegalPageId, LegalPage> = { terms, privacy, refunds }
