import { useMemo, useState } from 'react'
import type { Point } from '../lib/history'
import { num } from '../lib/format'

const W = 800

/** Area chart of Chainlink rounds. */
export function PriceChart({ points, height = 300, unit = 'oracle rounds' }: { points: Point[]; height?: number; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const H = height
  const padR = 70
  const padY = 16

  const geo = useMemo(() => {
    if (points.length < 2) return null
    const ps = points.map((x) => x.p)
    const lo = Math.min(...ps)
    const hi = Math.max(...ps)
    const pad = (hi - lo) * 0.1 || hi * 0.005
    const min = lo - pad
    const max = hi + pad
    const t0 = points[0].t
    const t1 = points[points.length - 1].t
    const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * (W - padR)
    const y = (v: number) => padY + ((max - v) / (max - min)) * (H - 2 * padY)
    const line = points.map((pt, i) => `${i ? 'L' : 'M'}${x(pt.t).toFixed(1)},${y(pt.p).toFixed(1)}`).join('')
    const area = `${line}L${x(t1).toFixed(1)},${H}L0,${H}Z`
    const ticks = Array.from({ length: 4 }, (_, i) => min + ((max - min) * (i + 0.5)) / 4)
    return { x, y, line, area, ticks }
  }, [points, H])

  if (!geo) return <div className="chart-empty muted small">Waiting for oracle history…</div>

  const last = points[points.length - 1]
  const shown = hover != null ? points[hover] : last
  const digits = last.p < 10 ? 4 : 2
  const first = points[0]
  const up = last.p >= first.p

  return (
    <div className="chart">
      <div className="chart-ohlc mono small">
        <span>{new Date(shown.t * 1000).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
        <span className={up ? 'up' : 'down'}>{num(shown.p, digits)}</span>
        <span>{points.length} {unit}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height: H }}
        className={up ? 'up' : 'down'}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          let best = 0
          points.forEach((p, i) => {
            if (Math.abs(geo.x(p.t) - px) < Math.abs(geo.x(points[best].t) - px)) best = i
          })
          setHover(best)
        }}
      >
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={0} x2={W - padR} y1={geo.y(t)} y2={geo.y(t)} className="grid" />
            <text x={W - padR + 6} y={geo.y(t) + 4} className="axis">
              {num(t, digits)}
            </text>
          </g>
        ))}
        <path d={geo.area} fill="url(#area)" />
        <path d={geo.line} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={W - padR} y1={geo.y(last.p)} y2={geo.y(last.p)} className="last-line" />
        <rect x={W - padR} y={geo.y(last.p) - 10} width={padR} height={20} className="last-tag" />
        <text x={W - padR + 6} y={geo.y(last.p) + 4} className="last-text">
          {num(last.p, digits)}
        </text>
        {hover != null && (
          <line x1={geo.x(points[hover].t)} x2={geo.x(points[hover].t)} y1={0} y2={H} className="crosshair" />
        )}
      </svg>
    </div>
  )
}
