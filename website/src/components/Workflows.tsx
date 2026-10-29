import { ChevronDown, CircleCheck, CircleDashed, CircleX, Eye, GitPullRequest, Loader, Play, RotateCw, ScrollText } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

const steps = [
  { n: '01', title: 'Start', text: 'Pick a workflow, a branch and its inputs. Choices, booleans and text fields come straight from the workflow file.' },
  { n: '02', title: 'Watch', text: 'Runs update live next to your agents. Follow one in a terminal, open its logs and search them.' },
  { n: '03', title: 'Fix', text: 'Re-run the failed jobs, cancel a stuck run, or hand the failing log to an agent as a mission.' }
]

const workflows = ['CI', 'Deploy', 'Release', 'Nightly e2e', 'CodeQL', 'Docs']

const runs: Array<{ st: 'active' | 'ok' | 'bad' | 'queued'; title: string; meta: string }> = [
  { st: 'active', title: 'Deploy to staging', meta: 'Deploy · main · dispatch · now' },
  { st: 'queued', title: 'Rate limit the API', meta: 'CI · sldev/rate-limit · push · 1m' },
  { st: 'bad', title: 'Fix login on Safari', meta: 'CI · fix/safari-login · pull_request · 12m' },
  { st: 'ok', title: 'Add dark mode', meta: 'CI · main · push · 40m' },
  { st: 'ok', title: 'v1.4.1', meta: 'Release · main · release · 2h' }
]

function RunIcon({ st }: { st: (typeof runs)[number]['st'] }) {
  if (st === 'active') return <Loader size={13} className="wfm-spin t-green" />
  if (st === 'queued') return <CircleDashed size={13} className="t-dim" />
  if (st === 'bad') return <CircleX size={13} className="t-red" />
  return <CircleCheck size={13} className="t-green" />
}

/** One line of the pane, revealed after the previous ones. */
function L({ i, children, className }: { i: number; children?: ReactNode; className?: string }) {
  return (
    <div className={`ln${className ? ` ${className}` : ''}`} style={{ '--i': i } as CSSProperties}>
      {children ?? ' '}
    </div>
  )
}

/** Replays the run's output each time the mock scrolls into view. */
function useSeen<T extends Element>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen((n) => n + 1), { threshold: 0.35 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, seen]
}

/** GitHub Actions without the browser tab: dispatch with inputs, follow runs, re-run what failed. */
export function WorkflowsSpotlight() {
  const [ref, seen] = useSeen<HTMLDivElement>()
  return (
    <section className="section" id="workflows">
      <div className="container">
        <p className="eyebrow">GitHub Workflows</p>
        <h2>Start a workflow and watch it finish, right next to your agents.</h2>
        <p className="section-lead">
          Every workflow in the repo, every recent run and the checks on your pull request, in one panel. No browser tab to keep
          refreshing.
        </p>

        <div className="mock brand-frame wfm" ref={ref} role="img" aria-label="sldev-io GitHub Workflows panel: running the Deploy workflow and watching it">
          <div className="mock-title">
            <span className="mock-dots"><i /><i /><i /></span>
            <span className="mock-name">sldev-io</span>
            <span className="mock-search">Search project <kbd>Ctrl+Shift+P</kbd></span>
          </div>
          <div className="wfm-body">
            <div className="wfm-side">
              <div className="mock-side-h">GitHub Workflows</div>
              <div className="wfm-repo">acme/shop</div>
              <div className="wfm-pr">
                <GitPullRequest size={13} className="t-green" />
                <div>
                  <b>#128 Rate limit the API</b>
                  <span><span className="t-green">6 passed</span> · 1 pending</span>
                </div>
              </div>
              <div className="wfm-sec"><ChevronDown size={12} /> Workflows <i>{workflows.length}</i></div>
              {workflows.map((w) => (
                <div key={w} className={`wfm-wf${w === 'Deploy' ? ' on' : ''}`}>
                  <span>{w}</span>
                  {w === 'Deploy' && <Play size={11} />}
                </div>
              ))}
              <div className="wfm-sec"><ChevronDown size={12} /> Runs <i>30</i></div>
              {runs.map((r) => (
                <div key={r.title} className="wfm-run">
                  <RunIcon st={r.st} />
                  <div>
                    <b>{r.title}</b>
                    <span>{r.meta}</span>
                  </div>
                  {r.st === 'bad' && <RotateCw size={12} className="wfm-act" />}
                  {r.st === 'active' && <Eye size={12} className="wfm-act" />}
                  {r.st === 'ok' && <ScrollText size={12} className="wfm-act" />}
                </div>
              ))}
            </div>
            <div className="wfm-main">
              <div className="wfm-form">
                <b>Run Deploy</b>
                <div className="wfm-fields">
                  <label>Branch<span className="wfm-in">main ▾</span></label>
                  <label>Environment *<span className="wfm-in">staging ▾</span></label>
                  <label>Version<span className="wfm-in mono">1.4.2</span></label>
                  <label className="wfm-check"><span className="wfm-box">✓</span> Run database migrations</label>
                </div>
                <span className="wfm-btn"><Play size={12} /> Run workflow</span>
              </div>
              <div className="wfm-term" key={seen}>
                <div className="wfm-term-h">run #212 · gh run watch</div>
                <pre>
                  <L i={0} className="t-dim">{'Refreshing run status every 3 seconds.'}</L>
                  <L i={1}>{'Deploy to staging · '}<span className="t-dim">main · workflow_dispatch</span></L>
                  <L i={2} />
                  <L i={3}><span className="t-green">{'✓'}</span>{' build       '}<span className="t-dim">in 41s</span></L>
                  <L i={4}><span className="t-green">{'✓'}</span>{' test        '}<span className="t-dim">in 1m12s</span></L>
                  <L i={5}><span className="t-green">{'✓'}</span>{' migrate     '}<span className="t-dim">in 9s</span></L>
                  <L i={6}><span className="t-amber">{'*'}</span>{' deploy      '}<span className="t-dim">in progress</span></L>
                  <L i={7} className="t-dim">{'  ✓ Push image ghcr.io/acme/shop:1.4.2'}</L>
                  <L i={8} className="t-dim">{'  * Roll out to staging (2/3 pods)'}</L>
                </pre>
              </div>
            </div>
          </div>
        </div>

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
  )
}
