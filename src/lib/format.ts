export const usd = (v: number, digits?: number) => {
  const d = digits ?? (Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 2 : 4)
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })
}

export const compactUsd = (v: number) =>
  '$' + Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v)

export const num = (v: number, digits = 2) =>
  v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const pct = (v: number, digits = 2) => `${(v * 100).toFixed(digits)}%`


export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export const cls = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

// The UI never shows a minus sign: direction is carried by an arrow instead.
export const arrow = (v: number) => (v >= 0 ? '▲' : '▼')

export const changePct = (v: number, digits = 2) => `${arrow(v)} ${(Math.abs(v) * 100).toFixed(digits)}%`

export const changeUsd = (v: number, digits?: number) => `${arrow(v)} ${usd(Math.abs(v), digits)}`

export const changeNum = (v: number, digits = 2) => `${arrow(v)} ${Math.abs(v).toFixed(digits)}`

export const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export const optionName = (asset: string, expiry: number, strike: number, type: 'call' | 'put') =>
  `${asset} ${new Date(expiry).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).toUpperCase()} ${strike} ${type === 'call' ? 'C' : 'P'}`
