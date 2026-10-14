import type { Candle } from '../lib/market'

export function Sparkline({ candles, width = 120, height = 32 }: { candles: Candle[]; width?: number; height?: number }) {
  const closes = candles.slice(-60).map((c) => c.c)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const pts = closes
    .map((c, i) => `${((i / (closes.length - 1)) * width).toFixed(1)},${(height - 2 - ((c - min) / (max - min || 1)) * (height - 4)).toFixed(1)}`)
    .join(' ')
  const up = closes[closes.length - 1] >= closes[0]
  return (
    <svg className={up ? 'spark up' : 'spark down'} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline points={pts} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
