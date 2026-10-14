// Mirrors LarryOptions: expiries are Fridays at 08:00 UTC, buyable until an hour before.
const WEEK = 604800
const FRIDAY_0800 = 115200

export interface Expiry {
  ts: number
  label: string
  days: number
}

export function validExpiries(maxExpirySeconds: number, nowS = Math.floor(Date.now() / 1000)): Expiry[] {
  const out: Expiry[] = []
  let e = nowS - ((nowS - FRIDAY_0800) % WEEK) + WEEK
  if (e - WEEK > nowS + 3600) e -= WEEK
  for (; e <= nowS + maxExpirySeconds; e += WEEK) {
    if (e <= nowS + 3600) continue
    out.push({
      ts: e,
      days: (e - nowS) / 86400,
      label: new Date(e * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase(),
    })
  }
  return out
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
