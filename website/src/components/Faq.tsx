import { ArrowRight } from 'lucide-react'
import type { Faq } from '../lib/site'

function FaqItem({ item }: { item: Faq }) {
  return (
    <details className="faq-item">
      <summary>{item.q}</summary>
      <p>{item.a}</p>
    </details>
  )
}

const faq: Faq[] = [
  { q: 'Is sldev-io really free?', a: 'Yes. Every feature, on every platform, with no trial, no account and no license key. The source is on GitHub under the Apache-2.0 license.' },
  { q: 'How is it paid for?', a: 'By sponsors. If sldev-io saves you time, a star on GitHub helps other developers find it, and a GitHub sponsorship keeps the work going. Neither unlocks anything: everyone gets the same app.' },
  { q: 'Is sldev-io an IDE?', a: 'No. There is no code editor. Files open in the editor you already use (Cursor, VS Code, Zed, JetBrains, Neovim and more). sldev-io is where your terminals and agents live.' },
  { q: 'Do I need an account with every agent?', a: 'sldev-io drives the agent CLIs that are already on your machine and uses their own logins. It never replaces your Claude, OpenAI, Cursor or GitHub subscription.' },
  { q: 'What happens when an agent hits its usage limit?', a: 'The mission says so and offers to continue on the next agent in your order, for example Codex after Claude Code. The next agent works in the same folder with the original task and the last output, so it finishes the work instead of starting over. Factory runs can do this on their own.' },
  { q: 'Which platforms are supported?', a: 'Windows 10/11, macOS (Intel and Apple Silicon) and Linux x86_64 (an AppImage that updates itself without a password, or a .deb for Debian/Ubuntu). Early builds are unsigned, so Windows shows a SmartScreen prompt and macOS needs a right-click → Open the first time.' },
  { q: 'Does it change my agent configuration?', a: 'No. Claude Code missions get a separate settings file passed on the command line, and your own settings are left alone.' },
  { q: 'Does sldev-io collect my data?', a: 'No. There is no account, no telemetry and no analytics. Your code, terminals, notes and credentials stay on your machine. The privacy policy lists the few network requests the app makes.' }
]

/** Every question, on /features. */
export function FaqSection() {
  return (
    <section className="section alt" id="faq">
      <div className="container narrow">
        <p className="eyebrow center">FAQ</p>
        <h2 className="center">Questions, answered.</h2>
        <div className="faq">
          {faq.map((f) => (
            <FaqItem key={f.q} item={f} />
          ))}
        </div>
      </div>
    </section>
  )
}

/** The questions people ask first, on the home page. */
export function HomeFaq() {
  const picks = [faq[0], faq[1], faq[2], faq[4]]
  return (
    <section className="section alt" id="faq">
      <div className="container narrow">
        <p className="eyebrow center">FAQ</p>
        <h2 className="center">Questions, answered.</h2>
        <div className="faq">
          {picks.map((f) => (
            <FaqItem key={f.q} item={f} />
          ))}
        </div>
        <p className="center faq-more">
          <a className="more-link" href="/features#faq">
            More questions <ArrowRight size={15} />
          </a>
        </p>
      </div>
    </section>
  )
}
