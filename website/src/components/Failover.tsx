import { ArrowRight, Check } from 'lucide-react'
import { L, useSeen } from './Workflows'

/**
 * The one thing a single-vendor tool can't do: when an agent stops at its plan's usage limit, another
 * agent picks the work up in the same folder. The pane replays each time it scrolls into view.
 */
export function FailoverSpotlight() {
  const [ref, seen] = useSeen<HTMLDivElement>()
  return (
    <section className="section" id="limits">
      <div className="container split">
        <div>
          <p className="eyebrow">Never wait for a limit reset</p>
          <h2>Claude hit its limit? Codex picks up where it left off.</h2>
          <p className="section-lead">
            You already pay for more than one agent. When one stops at its plan's usage limit, sldev-io hands the mission to the next one in
            your order, in the same folder, instead of leaving the work half done until the limit resets.
          </p>
          <ul className="checks">
            <li><Check size={16} /> The next agent gets the task, your notes and the last output, and finishes the work instead of starting over</li>
            <li><Check size={16} /> Uncommitted changes stay where they are, in the same worktree</li>
            <li><Check size={16} /> One click on a mission, or automatic for factory runs</li>
          </ul>
          <p className="spot-more">
            <a className="more-link" href="/docs/missions#limits">
              How it works <ArrowRight size={15} />
            </a>
          </p>
        </div>
        <div className="code brand-frame failover" ref={ref} role="img" aria-label="A Claude Code mission stops at its usage limit and Codex continues it in the same worktree">
          <div className="code-h">Mission · Migrate auth to sessions · sldev/auth-sessions</div>
          <pre key={seen}>
            <L i={0}><span className="t-dim">claude</span>{'  Updated src/auth/session.ts'}</L>
            <L i={1}><span className="t-dim">claude</span>{'  Updated src/routes/login.ts'}</L>
            <L i={2}><span className="t-dim">claude</span>{'  Running npm test…'}</L>
            <L i={3}><span className="t-dim">claude</span>{'  '}<span className="t-red">{'Usage limit reached · resets at 3pm'}</span></L>
            <L i={4} />
            <L i={5}><span className="t-amber">{'●'}</span>{' Stopped at its usage limit   '}<span className="failover-btn">{'Continue on Codex'}</span></L>
            <L i={6} />
            <L i={7}><span className="t-dim">codex </span>{'  Reading git status and the diff so far'}</L>
            <L i={8}><span className="t-dim">codex </span>{'  2 files changed; tests for logout still missing'}</L>
            <L i={9}><span className="t-dim">codex </span>{'  Added test/logout.test.ts'}</L>
            <L i={10}><span className="t-dim">codex </span>{'  '}<span className="t-green">{'✓ 48 tests passed'}</span></L>
            <L i={11} />
            <L i={12}><span className="t-green">{'●'}</span>{' Ready for review · 3 files changed'}</L>
          </pre>
        </div>
      </div>
    </section>
  )
}
