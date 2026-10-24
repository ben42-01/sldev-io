import { Check, X } from 'lucide-react'
import { site } from '../lib/pricing'

const before = [
  'A terminal tab per agent, and guessing which one is waiting for you',
  'Two agents editing the same folder at once',
  'Copying diffs around to review what an agent changed',
  'Yet another tool rewriting your agent settings'
]
const after = [
  'One window, live status for every agent, a ping when one needs you',
  'Each mission in its own git worktree',
  'Diff, commit and pull request built in',
  'Your own agent settings left untouched'
]

/** What sldev-io is and why it exists, in plain words. */
export function WhySection() {
  return (
    <section className="section" id="why">
      <div className="container split why">
        <div>
          <p className="eyebrow">Why sldev-io</p>
          <h2>Coding agents got good. Keeping track of them didn't.</h2>
          <p className="section-lead">
            You start Claude Code in one terminal, Codex in another, a dev server in a third. Twenty minutes later there are nine tabs,
            one agent has been waiting for a yes since lunch, and you can't remember which branch the other one is on.
          </p>
          <p className="section-lead">
            sldev-io gives that a home. Every agent runs in a real terminal in one window. You see at a glance which one is working,
            which is done and which needs you, and you go from its changes to a pull request in a few clicks.
          </p>
          <p className="why-note">
            It isn't an IDE and it isn't another AI subscription. It runs the agents you already use, and your files still open in your
            own editor.
          </p>
        </div>
        <div className="compare">
          <div className="compare-col">
            <p className="compare-h">Without</p>
            <ul>
              {before.map((t) => (
                <li key={t}>
                  <X size={15} /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="compare-col with">
            <p className="compare-h">With sldev-io</p>
            <ul>
              {after.map((t) => (
                <li key={t}>
                  <Check size={15} /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

/** A short personal note before pricing: who makes this and how it's paid for. */
export function MakerNote() {
  return (
    <section className="section">
      <div className="container">
        <figure className="maker brand-frame">
          <p className="eyebrow">A note from the maker</p>
          <blockquote>
            <p>
              Hi, I'm {site.maker}. I build software with coding agents every day, and I made sldev-io because I kept losing track of
              them. It's made by one person, not a venture-funded company: no account, no telemetry, no subscription.
            </p>
            <p>
              When it launches, you pay once and every update after that is yours. Until then it's free, so try it and tell me what's
              missing. I read every email.
            </p>
          </blockquote>
          <figcaption>
            {site.maker}, maker of sldev-io · <a href={`mailto:${site.contactEmail}`}>{site.contactEmail}</a>
          </figcaption>
        </figure>
      </div>
    </section>
  )
}
