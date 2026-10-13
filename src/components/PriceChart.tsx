import { useMemo, useState } from 'react'
import type { Candle } from '../lib/market'
import { num } from '../lib/format'

interface Props {
  candles: Candle[]
  height?: number
}

const W = 800

export function PriceChart({ candles, height = 320 }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const H = height
  const padR = 64
  const padY = 16

  const { min, max, xStep } = useMemo(() => {
    const lows = candles.map((c) => c.l)
    const highs = candles.map((c) => c.h)
    const lo = Math.min(...lows)
    const hi = Math.max(...highs)
    const pad = (hi - lo) * 0.08 || hi * 0.01
    return { min: lo - pad, max: hi + pad, xStep: (W - padR) / candles.length }
  }, [candles])

  const y = (v: number) => padY + ((max - v) / (max - min)) * (H - 2 * padY)
  const ticks = Array.from({ length: 5 }, (_, i) => min + ((max - min) * (i + 0.5)) / 5)
  const last = candles[candles.length - 1]
  const shown = hover != null ? candles[hover] : last
  const digits = last.c < 10 ? 4 : 2

  return (
    <div className="chart">
      <div className="chart-ohlc mono small">
        <span>O {num(shown.o, digits)}</span>
        <span>H {num(shown.h, digits)}</span>
        <span>L {num(shown.l, digits)}</span>
        <span className={shown.c >= shown.o ? 'up' : 'down'}>C {num(shown.c, digits)}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height: H }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const i = Math.floor((((e.clientX - r.left) / r.width) * W) / xStep)
          setHover(i >= 0 && i < candles.length ? i : null)
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={0} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" />
            <text x={W - padR + 6} y={y(t) + 4} className="axis">
              {num(t, digits)}
            </text>
          </g>
        ))}
        {candles.map((c, i) => {
          const x = i * xStep + xStep / 2
          const up = c.c >= c.o
          const bw = Math.max(xStep * 0.62, 1)
          return (
            <g key={c.t} className={up ? 'candle up' : 'candle down'}>
              <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} />
              <rect x={x - bw / 2} width={bw} y={y(Math.max(c.o, c.c))} height={Math.max(Math.abs(y(c.o) - y(c.c)), 1)} />
            </g>
          )
        })}
        <line x1={0} x2={W - padR} y1={y(last.c)} y2={y(last.c)} className="last-line" />
        <rect x={W - padR} y={y(last.c) - 10} width={padR} height={20} className="last-tag" />
        <text x={W - padR + 6} y={y(last.c) + 4} className="last-text">
          {num(last.c, digits)}
        </text>
        {hover != null && (
          <line x1={hover * xStep + xStep / 2} x2={hover * xStep + xStep / 2} y1={0} y2={H} className="crosshair" />
        )}
      </svg>
    </div>
  )
}
