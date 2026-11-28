import type { ReactNode } from 'react'
import { site } from '../lib/site'

export type LegalPageId = 'privacy'

export interface LegalPage {
  id: LegalPageId
  title: string
  summary: string
  body: ReactNode
}

const { legal } = site
const owner = legal.owner || '[owner name]'
const email = <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>

function Contact(): ReactNode {
  return (
    <>
      <h2>Contact</h2>
      <p>
        {owner}
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

const privacy: LegalPage = {
  id: 'privacy',
  title: 'Privacy policy',
  summary: 'No account, no telemetry, no analytics. Your code, terminals, notes and credentials stay on your machine.',
  body: (
    <>
      <h2>Who is responsible</h2>
      <p>
        {owner} ("we") is responsible for the personal data described here. Questions or requests: {email}.
      </p>

      <h2>On your machine</h2>
      <p>
        sldev-io keeps its settings, layout, missions, notes and saved connections in its data folder on your computer (Settings →
        About → Open data folder). Passwords and keys you save are encrypted with your operating system's keychain. None of this is
        sent to us. To remove it, uninstall the app and delete that folder.
      </p>

      <h2>What the app sends over the network</h2>
      <p>The app has no telemetry and no account: it never reports how you use it. On its own, it only makes this request:</p>
      <ul>
        <li>
          <b>Update check</b>: every few hours it asks GitHub, where our installers are hosted, whether a newer version exists, and
          downloads it if so. GitHub sees your IP address.
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
        every five minutes (and when you come back to the window, at most every 30 seconds) whether the pull request of a card waiting
        for review was merged; for a card that ran as a mission, that pull request is found by the branch its work was pushed from. Before a card's work starts, it runs git
        fetch against your branch's remote, so the work builds on pull requests that were already merged. That goes from your computer
        to GitHub (or wherever your remote is), signed in as you; nothing goes to us.
      </p>
      <p>
        The New project dialog asks GitHub through your GitHub CLI for the list of your repositories (name, description, whether it
        is private and when it last changed) each time you open it or press Retry. Cloning runs git on your computer, which downloads
        the repository you picked or pasted from where it lives; nothing is pushed. That goes from your computer to GitHub (or the
        host you pasted), signed in as you; nothing goes to us.
      </p>
      <p>
        When you open Create repository on GitHub for a new project, the app asks GitHub through your GitHub CLI for your login and
        the organizations you belong to. Only when you click Create and push does it ask whether a repository of the name you chose
        exists, create it with the name, owner, visibility and description you chose, and push your project's commits to it with
        git. That goes from your computer to GitHub, signed in as you; nothing goes to us.
      </p>
      <p>
        The GitHub stats panel asks GitHub through your GitHub CLI for your repository's open pull requests and issues, latest release,
        recent CI runs and the pull requests opened or merged in the range its activity chart shows. It asks when the panel is on screen,
        again every minute while it stays there, and when you press Refresh or change the range; never while it is hidden. That goes from
        your computer to GitHub, signed in as you; nothing goes to us.
      </p>
      <p>
        The Review tab of a mission that works in its own branch asks GitHub through your GitHub CLI for that branch's pull request and
        its workflow runs: when the tab comes on screen, every 15 seconds while a run is going (every minute otherwise), and when you press
        Refresh; never while the tab is hidden. Pushing, opening a pull request, re-running a workflow and merging a pull request happen
        only when you click them, the same way. A Review tab opened on a pull request reads that pull request (its title, description and
        diff) through your GitHub CLI when it opens and when you press Refresh. That goes from your computer to GitHub, signed in as you;
        nothing goes to us.
      </p>
      <p>
        Reviewing a pull request reads your repository's open pull requests (title, author, size, description, linked issues and who
        is asked to review them), your repository's latest 100 workflow runs (to show whether each pull request's checks pass on its
        latest commit) and your GitHub login through your GitHub CLI: when you open the Pull requests section of the
        Workflows tab or the "Review a pull request" command, every minute while that section stays open, and when you refresh it;
        never while the section is closed or the window is hidden. Opening one runs git fetch for that pull request's commits
        from your remote and checks them out in a separate folder of its own, and reads the issues it closes for their acceptance
        criteria. Nothing is pushed. While its Review tab is on screen, the pull request's state and its branch's workflow runs are
        read every 15 to 60 seconds. Approving, requesting changes, commenting (your summary and the notes you wrote, on their
        lines) and merging are each sent only when you click, after saying what will happen, as a review or merge of the commit you
        reviewed. That goes from your computer to GitHub (or wherever your remote is), signed in as you; nothing goes to us.
      </p>
      <p>
        The free sldev CLI makes one network request of its own: at most once a day, when you attach (<code>sldev</code>), it asks
        the npm registry (registry.npmjs.org) for the latest version of the sldev-cli package, so it can tell you when a newer one is
        out. That request carries nothing but the package name; npm sees your IP address, as with any npm install. When you click Update now (or press Ctrl-b u), it runs your own npm in a new tab to install the
        new version; nothing runs until you do. Turn the check off with
        <code>"updateCheck": false</code> in the CLI's config.json or <code>SLDEV_NO_UPDATE_CHECK=1</code>. Its workflows view (<code>sldev workflows</code>, or Ctrl-b w when
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

      <h2>When you sponsor</h2>
      <p>
        Sponsorships go through GitHub Sponsors, which handles the payment under GitHub's own privacy policy. We see what GitHub shows
        a maintainer: your GitHub username (unless you sponsor privately) and the tier. Card details never reach us. Sponsoring unlocks
        nothing in the app; everyone gets the same software.
      </p>

      <h2>Legal basis and retention</h2>
      <ul>
        <li>Request logs: our legitimate interest in running a secure website; they are kept for a short time.</li>
      </ul>

      <h2>Service providers</h2>
      <ul>
        <li>Vercel Inc. (website hosting)</li>
        <li>GitHub Inc. (source code, installer and update hosting, and GitHub Sponsors)</li>
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

export const legalPages: Record<LegalPageId, LegalPage> = { privacy }
