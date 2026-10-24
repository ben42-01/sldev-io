import { Check } from 'lucide-react'

const steps = [
  { n: '01', title: 'Launch', text: 'Write the prompt, pick an agent and an isolated worktree. The mission starts in its own terminal.' },
  { n: '02', title: 'Watch', text: 'Live status for every agent: working, needs you, ready for you. Desktop notifications when it matters.' },
  { n: '03', title: 'Ship', text: 'Review the diff, commit, merge or open the PR. Remove the worktree when you are done.' }
]

export function Spotlight() {
  return (
    <>
      <section className="section alt">
        <div className="container">
          <p className="eyebrow">How it works</p>
          <h2>From prompt to pull request in three steps.</h2>
          <div className="steps">
            {steps.map((s) => (
              <div className="step" key={s.n}>
                <span className="step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container split">
          <div>
            <p className="eyebrow">Agent-agnostic</p>
            <h2>Bring any CLI. Keep your settings.</h2>
            <p className="section-lead">
              Claude Code gets rich hook-based tracking without touching your own settings file. Every other agent is
              tracked from its terminal. Add your own with a command template.
            </p>
            <ul className="checks">
              <li><Check size={16} /> Your <code>~/.claude/settings.json</code> is never modified</li>
              <li><Check size={16} /> Same worktrees, diffs and notifications for every agent</li>
              <li><Check size={16} /> A real terminal, not a chat box: you can always type</li>
            </ul>
          </div>
          <div className="code brand-frame">
            <div className="code-h">Settings → Agents → Custom</div>
            <pre>
<span className="t-dim"># command template</span>{`
aider --message `}<span className="t-green">{'{prompt}'}</span>{` --model `}<span className="t-green">{'{model}'}</span>{`

`}<span className="t-dim"># tracked from the terminal</span>{`
output       → `}<span className="t-green">Working</span>{`
5s of quiet  → `}<span className="t-amber">Ready for you</span>{`
bell / OSC 9 → `}<span className="t-red">Needs you</span></pre>
          </div>
        </div>
      </section>
    </>
  )
}
