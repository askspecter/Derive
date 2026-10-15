// Same model as BlackScholesLib.sol (zero rate, A&S erf), used to price the chain locally.
// The order ticket always shows the exact onchain quote.

function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * z)
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z)
  return 0.5 * (1 + (x >= 0 ? erf : -erf))
}
const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)

export interface Quote {
  price: number
  delta: number
  theta: number // per day
}

export function blackScholes(isCall: boolean, S: number, K: number, years: number, vol: number): Quote {
  const intrinsic = isCall ? Math.max(S - K, 0) : Math.max(K - S, 0)
  if (years <= 0 || vol <= 0) return { price: intrinsic, delta: isCall ? +(S > K) : -(S < K), theta: 0 }
  const sq = vol * Math.sqrt(years)
  const d1 = (Math.log(S / K) + 0.5 * vol * vol * years) / sq
  const d2 = d1 - sq
  const price = isCall ? S * normCdf(d1) - K * normCdf(d2) : K * normCdf(-d2) - S * normCdf(-d1)
  return {
    price: Math.max(price, intrinsic),
    delta: isCall ? normCdf(d1) : normCdf(d1) - 1,
    theta: -(S * normPdf(d1) * vol) / (2 * Math.sqrt(years)) / 365,
  }
}

/** Premium per contract as LarryOptions.quote computes it, before the protocol fee. */
export function contractPremium(
  isCall: boolean,
  S: number,
  K: number,
  years: number,
  vol: number,
  spreadBps: number,
  minPremiumBps: number,
  shortDatedSpreadBps = 0,
) {
  // Mirrors LarryOptions: options with under a day left carry an extra spread.
  const spread = spreadBps + (years < 1 / 365 ? shortDatedSpreadBps : 0)
  let p = blackScholes(isCall, S, K, years, vol).price * (1 + spread / 1e4)
  p = Math.max(p, (S * minPremiumBps) / 1e4)
  return Math.min(p, K)
}
