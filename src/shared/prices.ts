/**
 * Approximate API list prices in USD per million tokens, for the usage dashboard's cost estimate.
 * They go stale: update them (and PRICES_CHECKED) with each release. A model that matches nothing
 * has no price, and its tokens are shown as unpriced instead of guessed.
 * Sources: Anthropic and OpenAI pricing pages, checked on PRICES_CHECKED.
 */
export const PRICES_CHECKED = '2026-10-26'

export interface Price {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** Cache reads at 0.1x and 5-minute cache writes at 1.25x the input price, unless a model says otherwise. */
const p = (input: number, output: number, cacheRead = input * 0.1, cacheWrite = input * 1.25): Price => ({ input, output, cacheRead, cacheWrite })

/** First match wins, so the more specific ids come first. Matched against the lowercased model id. */
const TABLE: Array<[RegExp, Price]> = [
  [/(fable|mythos)-5-1/, p(10, 50, 0.25)],
  [/(fable|mythos)-5/, p(10, 50)],
  [/opus-5-5/, p(4, 20, 0.2)],
  [/opus-5/, p(5, 25)],
  [/opus-4-[5-8]/, p(5, 25)],
  [/sonnet-5/, p(2, 10, 0.2)],
  [/sonnet-4/, p(3, 15)],
  [/haiku-5-5/, p(0.1, 0.5, 0.01)],
  [/haiku-4-5/, p(1, 5)],
  // OpenAI bills cached input only; there is no separate cache write
  [/gpt-5\.3-codex/, p(1.75, 14, 0.175, 0)],
  [/^gpt-5(-codex)?$/, p(1.25, 10, 0.125, 0)]
]

export function priceFor(model: string | undefined): Price | null {
  if (!model) return null
  const id = model.toLowerCase().trim()
  return TABLE.find(([re]) => re.test(id))?.[1] ?? null
}

export function costOf(u: { input: number; output: number; cacheRead: number; cacheWrite: number }, price: Price): number {
  return (u.input * price.input + u.output * price.output + u.cacheRead * price.cacheRead + u.cacheWrite * price.cacheWrite) / 1e6
}
