import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ASSETS } from '../config/markets'

export interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
}

interface MarketState {
  prices: Record<string, number>
  open24h: Record<string, number>
  candles: Record<string, Candle[]>
  funding: Record<string, number>
}

const MarketContext = createContext<MarketState | null>(null)

const CANDLE_MS = 60_000
const HISTORY = 120

// Seeded so every visitor sees a plausible, stable-looking history.
function seededRandom(seed: number) {
  let s = (Math.imul(seed ^ 0x5bd1e995, 2654435761) >>> 0) % 2147483646 + 1
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function gaussian(rand: () => number) {
  const u = Math.max(rand(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

function buildHistory(spot: number, vol: number, seed: number): Candle[] {
  const rand = seededRandom(seed)
  const stepVol = vol / Math.sqrt(365 * 24 * 60)
  const now = Math.floor(Date.now() / CANDLE_MS) * CANDLE_MS
  // Walk backwards from the current spot so the last close equals spot.
  const closes = [spot]
  for (let i = 1; i < HISTORY; i++) closes.unshift(closes[0] / Math.exp(stepVol * 3 * gaussian(rand)))
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1]
    const wick = c * stepVol * 2 * rand()
    return { t: now - (HISTORY - 1 - i) * CANDLE_MS, o, c, h: Math.max(o, c) + wick, l: Math.min(o, c) - wick }
  })
}

export function MarketProvider({ children }: { children: ReactNode }) {
  const [candles, setCandles] = useState<Record<string, Candle[]>>(() =>
    Object.fromEntries(ASSETS.map((a, i) => [a.symbol, buildHistory(a.spot, a.vol, 7919 * (i + 1))])),
  )
  const open24h = useRef<Record<string, number>>(
    Object.fromEntries(ASSETS.map((a, i) => [a.symbol, a.spot * (1 - 0.035 + 0.07 * seededRandom(i + 3)())])),
  )
  const funding = useMemo(
    () => Object.fromEntries(ASSETS.map((a, i) => [a.symbol, (seededRandom(i + 11)() - 0.35) * 0.0002])),
    [],
  )

  useEffect(() => {
    const id = setInterval(() => {
      setCandles((prev) => {
        const next: Record<string, Candle[]> = {}
        const now = Date.now()
        for (const a of ASSETS) {
          const list = prev[a.symbol]
          const last = list[list.length - 1]
          const stepVol = (a.vol / Math.sqrt(365 * 24 * 3600)) * Math.sqrt(1.5) * 2.5
          const price = last.c * Math.exp(stepVol * gaussian(Math.random))
          if (now - last.t >= CANDLE_MS) {
            next[a.symbol] = [...list.slice(1), { t: last.t + CANDLE_MS, o: last.c, h: Math.max(last.c, price), l: Math.min(last.c, price), c: price }]
          } else {
            next[a.symbol] = [...list.slice(0, -1), { ...last, c: price, h: Math.max(last.h, price), l: Math.min(last.l, price) }]
          }
        }
        return next
      })
    }, 1500)
    return () => clearInterval(id)
  }, [])

  const value = useMemo<MarketState>(() => {
    const prices = Object.fromEntries(Object.entries(candles).map(([s, c]) => [s, c[c.length - 1].c]))
    return { prices, candles, open24h: open24h.current, funding }
  }, [candles, funding])

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>
}

export function useMarket() {
  const ctx = useContext(MarketContext)
  if (!ctx) throw new Error('useMarket must be used inside MarketProvider')
  return ctx
}
