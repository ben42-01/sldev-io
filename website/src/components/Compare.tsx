import { Check, Minus } from 'lucide-react'
import { DownloadButton } from './Download'

type Cell = true | false | string

/** Categories, not products: what each kind of tool does out of the box. */
const columns = ['Terminal + tmux', 'AI code editor', 'sldev-io']

const rows: { what: string; cells: [Cell, Cell, Cell] }[] = [
  { what: 'Runs any CLI agent: Claude Code, Codex, Gemini, Copilot, your own', cells: [true, 'In its terminal', true] },
  { what: 'Several agents at once, each in its own git worktree', cells: ['By hand', 'Varies', true] },
  { what: 'Shows which agent is working, done or waiting for you', cells: [false, 'For its own agent', 'Every agent, with notifications and a badge'] },
  { what: 'Pipelines from an idea to a pull request, with your approvals', cells: [false, false, 'Software Factory'] },
  { what: 'One task on several agents, keep the best diff', cells: [false, false, true] },
  { what: 'Review comments go back to the agent that wrote the code', cells: [false, false, true] },
  { what: 'One rules file kept in sync for every agent', cells: [false, false, true] },
  { what: 'Time, tokens and estimated cost across agents', cells: [false, 'For its own agent', true] },
  { what: 'Edits code, autocomplete', cells: ['Your editor', true, 'No: files open in your editor'] },
  { what: 'Price', cells: ['Free', 'Usually a subscription', 'One payment, updates included'] }
]

function Value({ cell }: { cell: Cell }) {
  if (cell === true) return <Check size={16} className="vs-yes" aria-label="Yes" />
  if (cell === false) return <Minus size={16} className="vs-no" aria-label="No" />
  return <span>{cell}</span>
}

export function CompareTable() {
  return (
    <section className="section page-first">
      <div className="container">
        <div className="vs-wrap">
          <table className="vs-table">
            <thead>
              <tr>
                <th />
                {columns.map((c, i) => (
                  <th key={c} className={i === 2 ? 'vs-us' : undefined}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.what}>
                  <th scope="row">{r.what}</th>
                  {r.cells.map((c, i) => (
                    <td key={i} className={i === 2 ? 'vs-us' : undefined} data-label={columns[i]}>
                      <Value cell={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="vs-notes">
          <article>
            <h3>Keep your editor</h3>
            <p>
              sldev-io is not an IDE. If you mostly write code yourself with inline suggestions, an AI code editor is the better tool. sldev-io is
              for the other part of the day: running agents, watching them, reviewing what they did and getting it merged.
            </p>
          </article>
          <article>
            <h3>Already living in tmux?</h3>
            <p>
              The terminals in sldev-io are real terminals. What it adds is everything around them: worktrees per agent, knowing who needs you,
              diffs, pull requests and pipelines, without scripting it yourself.
            </p>
          </article>
          <article>
            <h3>Bring your own agents</h3>
            <p>
              You keep the agent CLIs and subscriptions you already pay for. sldev-io starts them on your machine and never sends your code or
              usage anywhere.
            </p>
          </article>
        </div>
        <div className="hero-cta center">
          <DownloadButton />
        </div>
      </div>
    </section>
  )
}
