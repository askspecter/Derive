export interface Expiry {
  label: string
  date: Date
  years: number
}

// Weekly Friday 08:00 UTC expiries plus the last Friday of the next months.
export function upcomingExpiries(now = new Date(), count = 6): Expiry[] {
  const out: Date[] = []
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8))
  while (out.length < 4) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (d.getUTCDay() === 5) out.push(new Date(d))
  }
  for (let m = 1; out.length < count; m++) {
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m + 1, 0, 8))
    while (last.getUTCDay() !== 5) last.setUTCDate(last.getUTCDate() - 1)
    if (!out.some((x) => x.getTime() === last.getTime()) && last > out[out.length - 1]) out.push(last)
  }
  return out.map((date) => ({
    date,
    years: (date.getTime() - now.getTime()) / (365 * 24 * 3600 * 1000),
    label: date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', timeZone: 'UTC' }).toUpperCase(),
  }))
}

export function strikesAround(spot: number, n = 6): number[] {
  const raw = spot * 0.025
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? raw
  const atm = Math.round(spot / step) * step
  const strikes: number[] = []
  for (let i = -n; i <= n; i++) {
    const k = atm + i * step
    if (k > 0) strikes.push(+k.toFixed(6))
  }
  return strikes
}
