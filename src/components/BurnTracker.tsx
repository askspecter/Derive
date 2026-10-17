import { useEffect, useRef, useState } from 'react'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { LARRY_TOKEN } from '../config/token'
import { useBurnFeed, useBurnTotals, type Burn } from '../lib/burn'
import { cls, shortAddr } from '../lib/format'
import { SmartLink as Link } from './SmartLink'

const whole = (v: number) => Math.round(v).toLocaleString('en-US')
const amount = (v: number) => (v >= 1000 ? whole(v) : v.toLocaleString('en-US', { maximumFractionDigits: 2 }))
const ago = (t: number | null) => {
  if (!t) return ''
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

/** Counts up smoothly to the latest value instead of jumping. */
function useTween(target: number, ms = 1600) {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (!target) return
    const start = performance.now()
    const a = from.current
    let raf = 0
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ms)
      const e = 1 - Math.pow(1 - p, 4)
      const x = a + (target - a) * e
      setV(x)
      from.current = x
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

/** Burns that arrived after the page loaded, so they can flash in. */
function useFresh(burns: Burn[] | undefined) {
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!burns) return
    if (!seen.current) {
      seen.current = new Set(burns.map((b) => b.hash))
      return
    }
    const added = burns.filter((b) => !seen.current!.has(b.hash)).map((b) => b.hash)
    added.forEach((h) => seen.current!.add(h))
    if (added.length) {
      setFresh(new Set(added))
      const id = setTimeout(() => setFresh(new Set()), 6000)
      return () => clearTimeout(id)
    }
  }, [burns])
  return fresh
}

export function BurnTracker({ compact }: { compact?: boolean }) {
  const t = useBurnTotals()
  const feed = useBurnFeed(t.decimals)
  const shown = useTween(t.burned)
  const burns = feed.data?.burns
  const fresh = useFresh(burns)
  const latest = burns?.[0]
  const list = burns?.slice(0, compact ? 5 : 50) ?? []

  return (
    <div className={cls('burn', compact && 'compact', fresh.size > 0 && 'flash')}>
      <div className="burn-hero card">
        <div className="burn-embers" aria-hidden />
        <div className="burn-top">
          <span className="eyebrow accent">$LARRY burned forever</span>
          <span className="burn-live">
            <i /> LIVE
          </span>
        </div>
        <div className="burn-count mono">{t.loading ? '…' : t.error ? '—' : whole(shown)}</div>
        <div className="burn-bar">
          <div style={{ width: `${Math.min(100, t.share * 100)}%` }} />
        </div>
        <div className="burn-facts">
          <div>
            <span className="muted small">Of total supply</span>
            <b className="mono">{t.error ? '' : `${(t.share * 100).toFixed(2)}%`}</b>
          </div>
          <div>
            <span className="muted small">Burns</span>
            <b className="mono">{burns ? (burns.length >= 200 ? '200+' : burns.length) : '…'}</b>
          </div>
          <div>
            <span className="muted small">Last burn</span>
            <b className="mono">{latest ? `${amount(latest.amount)}${latest.time ? ` · ${ago(latest.time)}` : ''}` : '…'}</b>
          </div>
        </div>
        {t.error && <p className="muted small">Could not read the token right now. Retrying.</p>}
      </div>

      <div className="burn-feed card">
        <div className="burn-feed-head">
          <h3>Every burn, onchain</h3>
          {compact ? (
            <Link to="/burn" className="link">
              Burn tracker →
            </Link>
          ) : (
            <a className="link" href={`${ROBINHOOD_CHAIN.explorerUrl}/token/${LARRY_TOKEN.address}?tab=holders`} target="_blank" rel="noreferrer">
              Explorer ↗
            </a>
          )}
        </div>
        {feed.isLoading && <div className="loading-bar" />}
        {burns && burns.length === 0 && <p className="muted small">No burns found yet.</p>}
        <div className="burn-rows">
          {list.map((b) => (
            <a key={b.hash} className={cls('burn-row', fresh.has(b.hash) && 'fresh')} href={`${ROBINHOOD_CHAIN.explorerUrl}/tx/${b.hash}`} target="_blank" rel="noreferrer">
              <span className="burn-fire">🔥</span>
              <span className="mono burn-amt">{amount(b.amount)} LARRY</span>
              <span className="mono small muted burn-from">from {shortAddr(b.from)}</span>
              <span className="small muted burn-when">{b.time ? ago(b.time) : b.block ? `block ${b.block}` : ''} ↗</span>
            </a>
          ))}
        </div>
        <p className="muted small burn-note">
          Sent to {shortAddr('0x000000000000000000000000000000000000dEaD')}, an address nobody holds the key to. Totals are read live from the $LARRY contract.
        </p>
      </div>
    </div>
  )
}
