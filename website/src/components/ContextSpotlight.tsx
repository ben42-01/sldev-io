import { ArrowRight } from 'lucide-react'
import { ContextGraph } from './ContextGraph'

const points = [
  {
    title: 'Every mission starts informed',
    text: "sldev-io matches the task against what earlier agents learned, your reference docs and pinned files, and points the agent at the few notes that matter. It's the same for every CLI: Claude, Codex, Cursor, Copilot, OpenCode, Gemini."
  },
  {
    title: 'Linked to your code',
    text: 'Notes are wired to the files they are about. Ask about a file and you get every note on it, plus the files those notes touch. When a file changes after its note was written, the note is flagged to check.'
  },
  {
    title: 'Yours, in the repo',
    text: 'The knowledge is plain Markdown in .sldev/: review it, edit it, commit it to share with your team. The search index is a local cache on your machine. Nothing is uploaded.'
  }
]

/**
 * Project context: one shared memory for every agent CLI. Single-vendor tools keep what their agent
 * learns to themselves; here it carries over to whichever agent runs next.
 */
export function ContextSpotlight() {
  return (
    <section className="section" id="context">
      <div className="container">
        <div className="section-head">
          <div>
            <p className="eyebrow">Project context</p>
            <h2>One memory for every agent, wired to your code.</h2>
            <p className="section-lead">
              What Claude figured out this morning, Codex knows this afternoon. sldev-io keeps what agents learn about your project, indexes it
              with your docs and files, and hands each new mission the notes that match its task, whichever agent runs it.
            </p>
          </div>
          <a className="more-link" href="/docs/context">
            How it works <ArrowRight size={15} />
          </a>
        </div>
        <ContextGraph />
        <div className="ctx-points">
          {points.map((p) => (
            <div key={p.title}>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
