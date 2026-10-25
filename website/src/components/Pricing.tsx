import { ArrowRight, Check, Clock } from 'lucide-react'
import { betaMessage, betaStatus, formatPrice, planCta, pricing, type Faq, type Plan } from '../lib/pricing'

function PlanCard({ plan }: { plan: Plan }) {
  const cta = planCta(plan)
  const discounted = plan.listPrice > plan.price
  const beta = betaStatus()
  const limited = beta.active && plan.price === 0 && discounted
  return (
    <article className={`plan${plan.highlight ? ' highlight brand-frame' : ''}`}>
      <div className="plan-head">
        <h3>{plan.name}</h3>
        {limited && (
          <span className="limited" title={beta.endsOn ? `Free until ${beta.endsOn}` : undefined}>
            <Clock size={12} /> {pricing.beta.label}
          </span>
        )}
      </div>
      <p className="plan-tagline">{plan.tagline}</p>
      <div className="plan-price">
        <span className="amount">{formatPrice(plan.price)}</span>
        {discounted && <s className="list">{formatPrice(plan.listPrice)}</s>}
      </div>
      <p className="plan-note">{plan.priceNote}</p>
      <a className={`btn lg${plan.highlight ? ' primary' : ''}`} href={cta.href} rel="noopener">
        {cta.label}
      </a>
      <ul>
        {plan.features.map((f) => (
          <li key={f}>
            <Check size={15} /> {f}
          </li>
        ))}
      </ul>
    </article>
  )
}

/** The plan cards with the beta announcement; the /pricing page supplies the heading. */
export function PricingPlans() {
  const beta = betaStatus()
  return (
    <section className="section page-first" id="plans">
      <div className="container">
        <p className="announce">{pricing.announcement}</p>
        {(beta.active || beta.ended) && (
          <p className={`beta-countdown${beta.ended ? ' ended' : ''}`}>
            <Clock size={14} /> {betaMessage(beta)}
            {beta.endsOn && !beta.ended && <span className="beta-date"> · free until {beta.endsOn}</span>}
          </p>
        )}
        <div className="plans">
          {pricing.plans.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </div>
      </div>
    </section>
  )
}

function FaqItem({ item }: { item: Faq }) {
  return (
    <details className="faq-item">
      <summary>{item.q}</summary>
      <p>{item.a}</p>
    </details>
  )
}

const generalFaq: Faq[] = [
  { q: 'Is sldev-io an IDE?', a: 'No. There is no code editor. Files open in the editor you already use (Cursor, VS Code, Zed, JetBrains, Neovim and more). sldev-io is where your terminals and agents live.' },
  { q: 'Which platforms are supported?', a: 'Windows 10/11, macOS (Intel and Apple Silicon) and Debian/Ubuntu Linux (.deb). Early builds are unsigned, so Windows shows a SmartScreen prompt and macOS needs a right-click → Open the first time.' },
  { q: 'Does it change my agent configuration?', a: 'No. Claude Code missions get a separate settings file passed on the command line, and your own settings are left alone.' }
]

export function FaqSection() {
  return (
    <section className="section alt" id="faq">
      <div className="container narrow">
        <p className="eyebrow center">FAQ</p>
        <h2 className="center">Questions, answered.</h2>
        <div className="faq">
          {[...pricing.faq, ...generalFaq].map((f) => (
            <FaqItem key={f.q} item={f} />
          ))}
        </div>
      </div>
    </section>
  )
}

/** The three questions people ask first, on the home page. */
export function HomeFaq() {
  const picks = [generalFaq[0], pricing.faq[2], pricing.faq[5]]
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
          <a className="more-link" href="/pricing#faq">
            Pricing and more questions <ArrowRight size={15} />
          </a>
        </p>
      </div>
    </section>
  )
}
