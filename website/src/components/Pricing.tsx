import { Check } from 'lucide-react'
import { formatPrice, planCta, pricing, type Faq, type Plan } from '../lib/pricing'

function PlanCard({ plan }: { plan: Plan }) {
  const cta = planCta(plan)
  const discounted = plan.listPrice > plan.price
  return (
    <article className={`plan${plan.highlight ? ' highlight brand-frame' : ''}`}>
      <h3>{plan.name}</h3>
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

export function Pricing() {
  return (
    <section className="section alt" id="pricing">
      <div className="container">
        <p className="eyebrow center">Pricing</p>
        <h2 className="center">Pay once. Own it.</h2>
        <p className="section-lead center">No subscription, no seat meter. A single {pricing.billing} payment per license.</p>
        <p className="announce">{pricing.announcement}</p>
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
  { q: 'Which platforms are supported?', a: 'Linux (AppImage, deb, rpm), Windows and macOS (Intel and Apple Silicon). Early builds are unsigned, so Windows shows a SmartScreen prompt and macOS needs a right-click → Open the first time.' },
  { q: 'Does it change my agent configuration?', a: 'No. Claude Code missions get a separate settings file passed on the command line, and your own settings are left alone.' }
]

export function FaqSection() {
  return (
    <section className="section" id="faq">
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
