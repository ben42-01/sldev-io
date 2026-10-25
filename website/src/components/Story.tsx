import { Check, X } from 'lucide-react'

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
            Claude Code in one terminal, Codex in another, a dev server in a third. Twenty minutes later there are nine tabs, one agent
            has been waiting for a yes since lunch, and nobody remembers which branch the other one is on.
          </p>
          <p className="why-note">
            sldev-io isn't an IDE and isn't another AI subscription. It runs the agents you already use, and your files still open in
            your own editor.
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
