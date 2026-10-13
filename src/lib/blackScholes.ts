// Black-Scholes pricing and greeks, used to quote the options chain.

const SQRT_2PI = Math.sqrt(2 * Math.PI)

export const normPdf = (x: number) => Math.exp(-0.5 * x * x) / SQRT_2PI

// Abramowitz & Stegun 26.2.17 approximation of the standard normal CDF.
export function normCdf(x: number): number {
  const k = 1 / (1 + 0.2316419 * Math.abs(x))
  const poly =
    k * (0.31938153 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))))
  const p = 1 - normPdf(x) * poly
  return x >= 0 ? p : 1 - p
}

export type OptionType = 'call' | 'put'

export interface Greeks {
  price: number
  delta: number
  gamma: number
  theta: number // per day
  vega: number // per 1 vol point
}

export function blackScholes(
  type: OptionType,
  spot: number,
  strike: number,
  years: number,
  vol: number,
  rate = 0.04,
): Greeks {
  const t = Math.max(years, 1 / (365 * 24))
  const sqrtT = Math.sqrt(t)
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * t) / (vol * sqrtT)
  const d2 = d1 - vol * sqrtT
  const disc = Math.exp(-rate * t)
  const pdf = normPdf(d1)

  const price =
    type === 'call'
      ? spot * normCdf(d1) - strike * disc * normCdf(d2)
      : strike * disc * normCdf(-d2) - spot * normCdf(-d1)
  const delta = type === 'call' ? normCdf(d1) : normCdf(d1) - 1
  const gamma = pdf / (spot * vol * sqrtT)
  const thetaYear =
    type === 'call'
      ? (-spot * pdf * vol) / (2 * sqrtT) - rate * strike * disc * normCdf(d2)
      : (-spot * pdf * vol) / (2 * sqrtT) + rate * strike * disc * normCdf(-d2)
  const vega = (spot * pdf * sqrtT) / 100

  return { price: Math.max(price, 0), delta, gamma, theta: thetaYear / 365, vega }
}

// Simple volatility smile: higher IV away from the money, put skew.
export function smileVol(atmVol: number, spot: number, strike: number, years: number): number {
  // Standardised moneyness: how many ATM standard deviations the strike is away.
  const m = Math.log(strike / spot) / (atmVol * Math.sqrt(Math.max(years, 1 / 365)))
  return Math.min(atmVol * 2.5, Math.max(0.05, atmVol * (1 + 0.035 * m * m - 0.04 * m)))
}
