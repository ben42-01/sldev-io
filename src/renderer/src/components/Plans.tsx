import { Check, ExternalLink } from 'lucide-react'
import { appPlans } from '@shared/pricing'

const plans = appPlans(__PRICING__, __SANDBOX_CHECKOUT__)

/** The plans with buy buttons. Checkout runs in the browser (Polar), which emails the key to paste into the license form. */
export function Plans(): React.JSX.Element | null {
  if (!plans.length) return null
  return (
    <div className="plans">
      <div className="plans-grid">
        {plans.map((p) => (
          <div key={p.id} className={`plan-card${p.highlight ? ' highlight' : ''}`} data-plan={p.id}>
            <div className="plan-head">
              <span className="plan-name">{p.name}</span>
              <span className="plan-price">{p.price}</span>
            </div>
            <div className="plan-tagline">{p.tagline}</div>
            <div className="plan-note">{p.priceNote}</div>
            <ul className="plan-features">
              {p.features.slice(0, 5).map((f) => (
                <li key={f}>
                  <Check size={12} /> {f}
                </li>
              ))}
            </ul>
            <button className={`btn sm${p.highlight ? ' primary' : ''}`} data-href={p.checkoutUrl} onClick={() => void window.api.shell.openExternal(p.checkoutUrl)}>
              {p.buyLabel} <ExternalLink size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="field-hint">
        Checkout opens in your browser{__SANDBOX_CHECKOUT__ ? ' (Polar sandbox: no real payment)' : ''}. Your license key arrives by email; paste it below.
      </div>
    </div>
  )
}
