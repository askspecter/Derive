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

export const signedPct = (v: number, digits = 2) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export const cls = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')
