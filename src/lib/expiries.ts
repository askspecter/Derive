// Mirrors LarryOptions: expiries are Fridays at 08:00 UTC, plus every day at 08:00 UTC on
// markets with daily expiries. All are buyable until an hour before.
const DAY = 86400
const WEEK = 604800
const DAY_0800 = 28800
const FRIDAY_0800 = 115200
/** Daily expiries are shown for this many days ahead; Fridays beyond that. */
const DAILY_DAYS = 7

export interface Expiry {
  ts: number
  label: string
  days: number
  /** Expires within a day: a 0DTE option. */
  zeroDte: boolean
  /** A daily expiry that is not a Friday. */
  daily: boolean
}

export function validExpiries(maxExpirySeconds: number, daily = false, nowS = Math.floor(Date.now() / 1000)): Expiry[] {
  const ts = new Set<number>()
  // Fridays
  let e = nowS - ((nowS - FRIDAY_0800) % WEEK)
  for (; e <= nowS + maxExpirySeconds; e += WEEK) if (e > nowS + 3600) ts.add(e)
  // Every day at 08:00 for the next week
  if (daily) {
    let d = nowS - ((nowS - DAY_0800) % DAY)
    for (; d <= nowS + Math.min(maxExpirySeconds, DAILY_DAYS * DAY); d += DAY) if (d > nowS + 3600) ts.add(d)
  }
  return [...ts]
    .sort((a, b) => a - b)
    .map((t) => ({
      ts: t,
      days: (t - nowS) / DAY,
      zeroDte: t - nowS <= DAY,
      daily: t % WEEK !== FRIDAY_0800,
      label: new Date(t * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase(),
    }))
}
/** About a dozen round strikes around spot, inside the contract's 0.5x to 2x band. */
export function strikesAround(spot: number, n = 6): number[] {
  const raw = spot * 0.025
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? raw
  const atm = Math.round(spot / step) * step
  const out: number[] = []
  for (let i = -n; i <= n; i++) {
    const k = +(atm + i * step).toFixed(6)
    if (k > spot * 0.5 && k < spot * 2) out.push(k)
  }
  return out
}
