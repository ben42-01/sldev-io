import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Circle, CornerDownRight, GitMerge, Heart, Scissors, Sparkles, Star, Trophy, X } from 'lucide-react'
import { site } from '../lib/site'
import { DownloadButton } from './Download'

/**
 * The home page's argument in three parts: the shift (writing code got cheap, deciding what ships didn't),
 * the loop that answers it (plan, build, review, prove; each with a picture of the real feature), and the
 * deal: free and open source, kept going by stars and sponsors.
 */

export function Shift() {
  const points = [
    { n: '01', title: 'One agent is a tool. Several are a team.', text: 'And a team needs a lead: someone who plans, hands out the work and merges what passes. That is a job, not a terminal tab.' },
    { n: '02', title: 'Nobody reads every line anymore.', text: 'Agents write more code than anyone can review file by file. The question is why each part is there, and whether anyone asked for it.' },
    { n: '03', title: 'Benchmarks are not your code.', text: 'Which agent is best at your API, your tests, your bugs? Measure it on your repository, then let the numbers route the work.' }
  ]
  return (
    <section className="shift" aria-labelledby="shift-h">
      <div className="container">
        <p className="eyebrow">The shift</p>
        <h2 id="shift-h" className="shift-h">
          Writing code got cheap.
          <br />
          <span className="brand-text">Deciding what ships didn't.</span>
        </h2>
        <div className="shift-points">
          {points.map((p) => (
            <div className="shift-point" key={p.n}>
              <span className="shift-n">{p.n}</span>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </div>
          ))}
        </div>
        <p className="shift-answer">
          sldev-io is where you lead that team. <b>You make four decisions. Agents from every vendor do everything in between.</b>
        </p>
      </div>
    </section>
  )
}

interface Chapter {
  id: string
  verb: string
  title: string
  text: string
  decision: string
  href: string
  more: string
  Stage: () => React.JSX.Element
}

const CHAPTERS: Chapter[] = [
  {
    id: 'plan',
    verb: 'Plan',
    title: 'Plan in the chat. It lands as a draft.',
    text: 'Talk a feature through with any agent. The sldev skills turn the plan into stories with acceptance criteria, in the right order, on your board.',
    decision: 'You approve the stories',
    href: '/docs/missions#skills',
    more: 'The sldev skills',
    Stage: PlanStage
  },
  {
    id: 'build',
    verb: 'Build',
    title: 'A Lead splits it. The team builds in parallel.',
    text: 'Codex on the API, Claude on the UI, Gemini on the tests, each in its own worktree. The Lead reviews every diff, sends work back and merges what passes.',
    decision: 'Your tests decide what merges',
    href: '/docs/lead',
    more: 'How a Lead works',
    Stage: BuildStage
  },
  {
    id: 'review',
    verb: 'Review',
    title: 'Review why, not just what.',
    text: 'The change in parts, in reading order: why each is there, whether it was asked for, a simpler way, what could break. Noise folded, overengineering visible at a glance.',
    decision: 'You keep, send back or cut each part',
    href: '/docs/missions#review',
    more: 'The review walkthrough',
    Stage: ReviewStage
  },
  {
    id: 'prove',
    verb: 'Prove',
    title: 'Let your code decide who gets the work.',
    text: 'Evals are tasks from your repo with checks: tests that must pass, a limit on the diff, a judge with a rubric. The leaderboard routes the next task to the agent that earned it.',
    decision: 'You choose what is measured',
    href: '/docs/evals',
    more: 'Write your first eval',
    Stage: ProveStage
  }
]

const STEP_MS = 7000

/** The loop: four chapters that play in turn (paused on hover or once you pick one), each with its own stage. */
export function Loop() {
  const [at, setAt] = useState(0)
  const [auto, setAuto] = useState(true)
  const [hover, setHover] = useState(false)
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const playing = auto && !hover && visible && !reduced
  useEffect(() => {
    if (!playing) return
    const t = setTimeout(() => setAt((a) => (a + 1) % CHAPTERS.length), STEP_MS)
    return () => clearTimeout(t)
  }, [playing, at])
  const pick = (i: number): void => {
    setAt(i)
    setAuto(false)
  }
  const c = CHAPTERS[at]
  return (
    <section className="section loop" id="how" ref={ref} aria-labelledby="loop-h">
      <div className="container">
        <div className="loop-head">
          <p className="eyebrow">How it works</p>
          <h2 id="loop-h">
            Plan. Build. Review. <span className="brand-text">Prove.</span>
          </h2>
          <p className="section-lead">One loop, from an idea to a pull request you trust, with agents from every vendor on your own machine.</p>
        </div>
        <div className="loop-body" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
          <div className="loop-tabs" role="tablist" aria-label="The four steps">
            {CHAPTERS.map((ch, i) => (
              <button
                key={ch.id}
                role="tab"
                id={`loop-tab-${ch.id}`}
                aria-selected={i === at}
                aria-controls="loop-stage"
                className={`loop-tab${i === at ? ' on' : ''}`}
                onClick={() => pick(i)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') (e.preventDefault(), pick((i + 1) % CHAPTERS.length))
                  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') (e.preventDefault(), pick((i + CHAPTERS.length - 1) % CHAPTERS.length))
                }}
                tabIndex={i === at ? 0 : -1}
              >
                <span className="loop-num">0{i + 1}</span>
                <span className="loop-tab-main">
                  <span className="loop-verb">{ch.verb}</span>
                  <span className="loop-title">{ch.title}</span>
                  {i === at && (
                    <>
                      <span className="loop-text">{ch.text}</span>
                      <span className="loop-decision">
                        <CornerDownRight size={13} /> {ch.decision}
                      </span>
                    </>
                  )}
                </span>
                {i === at && <span className={`loop-progress${playing ? ' run' : ''}`} key={`${at}-${playing}`} style={{ animationDuration: `${STEP_MS}ms` }} />}
              </button>
            ))}
          </div>
          <div className="loop-stage" id="loop-stage" role="tabpanel" aria-labelledby={`loop-tab-${c.id}`}>
            {/* on a phone the tabs are a row of four; the step's words go here, right above its picture */}
            <div className="loop-copy">
              <span className="loop-title">{c.title}</span>
              <span className="loop-text">{c.text}</span>
              <span className="loop-decision">
                <CornerDownRight size={13} /> {c.decision}
              </span>
            </div>
            <div className="loop-stage-frame" key={c.id}>
              <c.Stage />
            </div>
            <a className="more-link loop-more" href={c.href}>
              {c.more} <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

function PlanStage() {
  const stories = [
    { key: 14, title: 'Create a team', labels: ['api'], state: 'approved' },
    { key: 15, title: 'Invite people by email', labels: ['feature'], waits: 14 },
    { key: 16, title: 'Owners remove members', labels: ['feature', 'auth'], waits: 14 }
  ]
  return (
    <div className="stage plan-stage" role="img" aria-label="In a terminal, Claude runs the sldev-stories skill and writes three stories; they appear in the board's Proposed column, one already approved">
      <div className="stage-term">
        <div className="st-line"><span className="t-dim">you</span>  let owners invite people to a team. /sldev-stories</div>
        <div className="st-line d1"><span className="t-purple">claude</span> read 14 files · 3 stories, the API first</div>
        <div className="st-line d2"><span className="t-green">✓</span> filed in sldev-io → Board → Proposed</div>
      </div>
      <div className="stage-col">
        <div className="stage-col-h">
          <span>Proposed</span>
          <em>written by agents</em>
        </div>
        {stories.map((s, i) => (
          <div className={`stage-card d${i + 3}`} key={s.key}>
            <div className="sc-top">
              <span className="sc-key">#{s.key}</span>
              <span className="sc-by"><Sparkles size={10} /> claude</span>
            </div>
            <div className="sc-title">{s.title}</div>
            <div className="sc-meta">
              {s.labels.map((l) => <span className="sc-label" key={l}>{l}</span>)}
              {s.waits && <span className="sc-waits">waits for #{s.waits}</span>}
              {s.state === 'approved' ? <span className="sc-ok"><Check size={11} /> approved</span> : <span className="sc-btn"><Check size={11} /> Approve</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BuildStage() {
  const lanes = [
    { agent: 'Codex', task: 'Invites API', note: 'best on your evals · 9/10', state: 'merged', w: 100 },
    { agent: 'Claude Code', task: 'Invite email + UI', note: 'sent back once: no rate limit', state: 'merged', w: 100 },
    { agent: 'Gemini CLI', task: 'Tests for invites', note: '3 worktrees, in parallel', state: 'working', w: 72 }
  ]
  return (
    <div className="stage build-stage" role="img" aria-label="A Lead delegates three tasks to Codex, Claude Code and Gemini CLI, each in its own worktree; two are merged, one is still working">
      <div className="bs-lead">
        <span className="bs-dot" /> <b>Lead</b> · Team invites <span className="t-dim">· feature/team-invites</span>
      </div>
      <div className="bs-lanes">
        {lanes.map((l, i) => (
          <div className={`bs-lane ${l.state} d${i + 1}`} key={l.agent}>
            <div className="bs-row">
              <b>{l.agent}</b>
              <span className="bs-task">{l.task}</span>
              <span className={`bs-state ${l.state}`}>{l.state === 'merged' ? <><GitMerge size={11} /> merged</> : 'working'}</span>
            </div>
            <div className="bs-bar"><i style={{ '--w': `${l.w}%` } as React.CSSProperties} /></div>
            <div className="bs-note">{l.note}</div>
          </div>
        ))}
      </div>
      <div className="bs-foot d4">
        <span className="t-green">✓</span> npm test · 112 passed <span className="t-dim">· nothing pushed until you click</span>
      </div>
    </div>
  )
}

function ReviewStage() {
  return (
    <div className="stage review-stage" role="img" aria-label="The review: two acceptance criteria met, one not yet; a bar shows the change is mostly what was asked, with a part nobody asked for and folded noise; the part nobody asked for is cut and goes back to the agent">
      <div className="rv-ask">
        <div className="rv-ask-h">The ask · Invite people to a team</div>
        <ul>
          <li className="met"><Check size={12} /> Owners invite by email</li>
          <li className="met"><Check size={12} /> Invites expire after 7 days</li>
          <li><Circle size={11} /> Rate limit on /invite <em>part 3</em></li>
        </ul>
      </div>
      <div className="rv-bar" aria-hidden="true">
        <i className="a" style={{ flexGrow: 46 }} />
        <i className="s" style={{ flexGrow: 18 }} />
        <i className="x" style={{ flexGrow: 9 }} />
        <i className="n" style={{ flexGrow: 27 }} />
      </div>
      <div className="rv-keys">
        <span><b className="a" /> asked for</span>
        <span><b className="s" /> supports it</span>
        <span><b className="x" /> not asked for</span>
        <span><b className="n" /> noise, folded</span>
      </div>
      <div className="rv-parts">
        <div className="rv-part ok d1"><span className="rv-n">1</span> Invite endpoint <em>asked for</em><span className="rv-v ok"><Check size={11} /> looks good</span></div>
        <div className="rv-part ok d2"><span className="rv-n">2</span> Email template <em>supports it</em><span className="rv-v ok"><Check size={11} /> looks good</span></div>
        <div className="rv-part cut d3"><span className="rv-n">3</span> A job queue "for later" <em>not asked for · simpler: send it inline</em><span className="rv-v cut"><Scissors size={11} /> cut it</span></div>
        <div className="rv-part dim d4"><span className="rv-n">·</span> package-lock.json, 2 renames <em>noise</em><span className="rv-v">folded</span></div>
      </div>
      <div className="rv-foot d5">Send 1 part back to Codex <ArrowRight size={12} /></div>
    </div>
  )
}

function ProveStage() {
  const rows = [
    { agent: 'Codex', pass: 90, time: '3.2 min', diff: '84 lines', best: true },
    { agent: 'Claude Code · opus', pass: 80, time: '4.1 min', diff: '61 lines' },
    { agent: 'Gemini CLI', pass: 60, time: '2.7 min', diff: '120 lines' }
  ]
  return (
    <div className="stage prove-stage" role="img" aria-label="An eval leaderboard on your own repository: Codex passes 90%, Claude Code 80%, Gemini CLI 60%; the next API task is routed to Codex">
      <div className="pv-h"><Trophy size={13} /> Your repo · 10 evals × 3 attempts</div>
      <div className="pv-rows">
        {rows.map((r, i) => (
          <div className={`pv-row d${i + 1}${r.best ? ' best' : ''}`} key={r.agent}>
            <span className="pv-agent">{r.agent}</span>
            <span className="pv-bar"><i style={{ '--w': `${r.pass}%` } as React.CSSProperties} /></span>
            <span className="pv-pass">{r.pass}%</span>
            <span className="pv-meta">{r.time} · {r.diff}</span>
          </div>
        ))}
      </div>
      <pre className="pv-yaml d4">{`# .sldev/evals/leap-years.yml
brief: parseDate must accept Feb 29 in leap years.
checks:
  - run: npm test
  - diff: 80
  - judge: Adds a test for 2024-02-29.`}</pre>
      <div className="pv-route d5">
        <span className="t-purple">agent: auto</span> → the next API task goes to <b>Codex</b>
      </div>
    </div>
  )
}

/** Free and open source, on the home page: what it costs (nothing) and how to help. */
export function FreeBand() {
  return (
    <section className="section price-band" id="free" aria-labelledby="free-h">
      <div className="container">
        <div className="pb-inner">
          <div className="pb-copy">
            <p className="eyebrow">Free and open source</p>
            <h2 id="free-h">
              Your agents bill monthly.
              <br />
              <span className="brand-text">Their lead doesn't.</span>
            </h2>
            <p className="section-lead">
              Keep the agent plans you already pay for. sldev-io makes them one team, and costs nothing: every feature, no trial, no account, no
              license key.
            </p>
          </div>
          <div className="pb-card brand-frame">
            <div className="pb-plan">Everyone</div>
            <div className="pb-price">
              Free
              <span>Apache-2.0</span>
            </div>
            <ul className="pb-list">
              <li><Check size={14} /> Every feature, every agent</li>
              <li><Check size={14} /> Linux, Windows and macOS</li>
              <li><Check size={14} /> Source on GitHub</li>
              <li className="no"><X size={14} /> No account, no license key, no telemetry</li>
            </ul>
            <div className="pb-cta">
              <DownloadButton />
              <a className="more-link" href={site.sourceUrl}>
                <Star size={15} /> Star on GitHub
              </a>
              <a className="more-link" href={site.sponsorUrl}>
                <Heart size={15} /> Sponsor <ArrowRight size={15} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
