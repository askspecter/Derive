import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { assetBySymbol } from '../config/markets'
import { AssetTabs } from '../components/AssetTabs'
import { PriceChart } from '../components/PriceChart'
import { blackScholes, smileVol, type OptionType } from '../lib/blackScholes'
import { strikesAround, upcomingExpiries } from '../lib/expiries'
import { cls, num, pct, usd } from '../lib/format'
import { useMarket } from '../lib/market'
import { useAccount, type Side } from '../lib/account'
import { PositionsPanel } from '../components/PositionsPanel'

interface Selection {
  type: OptionType
  strike: number
  side: Side
}

const SPREAD = 0.015

export function Options() {
  const [params, setParams] = useSearchParams()
  const symbol = assetBySymbol(params.get('asset') ?? 'ETH').symbol
  const asset = assetBySymbol(symbol)
  const { prices, candles } = useMarket()
  const account = useAccount()
  const spot = prices[symbol]
  const expiries = useMemo(() => upcomingExpiries(), [])
  const [expIdx, setExpIdx] = useState(0)
  const expiry = expiries[expIdx]
  // Strikes are anchored to the listing spot so the chain doesn't reshuffle on every tick.
  const strikes = useMemo(() => strikesAround(asset.spot), [asset.spot])
  const [sel, setSel] = useState<Selection | null>(null)
  const [size, setSize] = useState('1')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const quote = (type: OptionType, strike: number) => {
    const iv = smileVol(asset.vol, spot, strike, expiry.years)
    const g = blackScholes(type, spot, strike, expiry.years, iv)
    const half = Math.max(g.price * SPREAD, spot * 0.0002)
    return { ...g, iv, bid: Math.max(g.price - half, 0), ask: g.price + half }
  }

  const selQuote = sel ? quote(sel.type, sel.strike) : null
  const qty = Math.max(parseFloat(size) || 0, 0)
  const execPrice = selQuote && sel ? (sel.side === 'buy' ? selQuote.ask : selQuote.bid) : 0
  const premium = execPrice * qty
  const breakeven = sel ? (sel.type === 'call' ? sel.strike + execPrice : sel.strike - execPrice) : 0

  const submit = () => {
    if (!sel || !selQuote || qty <= 0) return
    const err = account.openOption({
      asset: symbol,
      type: sel.type,
      strike: sel.strike,
      expiry: expiry.date.getTime(),
      side: sel.side,
      size: qty,
      entry: execPrice,
    })
    setMsg(err ? { ok: false, text: err } : { ok: true, text: `Order filled: ${sel.side} ${qty} ${symbol} ${sel.strike} ${sel.type}` })
  }

  const pick = (type: OptionType, strike: number, side: Side) => {
    setSel({ type, strike, side })
    setMsg(null)
  }

  return (
    <div className="app-page">
      <AssetTabs value={symbol} onChange={(s) => { setParams({ asset: s }); setSel(null) }} />
      <div className="trade-layout">
        <div className="trade-main">
          <div className="card">
            <div className="market-head">
              <div>
                <h2>
                  {symbol} Options <span className="muted small">{asset.name}</span>
                </h2>
                <div className="mono big">{usd(spot)}</div>
              </div>
              <div className="market-meta">
                <div>
                  <div className="muted small">ATM IV</div>
                  <div className="mono">{pct(asset.vol, 1)}</div>
                </div>
                <div>
                  <div className="muted small">Expiry</div>
                  <div className="mono">{expiry.date.toISOString().slice(0, 10)}</div>
                </div>
                <div>
                  <div className="muted small">Time left</div>
                  <div className="mono">{(expiry.years * 365).toFixed(1)}d</div>
                </div>
              </div>
            </div>
            <PriceChart candles={candles[symbol]} height={240} />
          </div>

          <div className="card">
            <div className="chain-head">
              <div className="seg">
                {expiries.map((e, i) => (
                  <button key={e.label} className={cls(i === expIdx && 'active')} onClick={() => setExpIdx(i)}>
                    {e.label}
                  </button>
                ))}
              </div>
              <div className="muted small">Click bid to sell, ask to buy</div>
            </div>
            <div className="table-wrap">
              <table className="table chain">
                <thead>
                  <tr>
                    <th className="r hide-sm">Δ</th>
                    <th className="r hide-sm">IV</th>
                    <th className="r">Bid</th>
                    <th className="r">Ask</th>
                    <th className="c strike-col">Strike</th>
                    <th className="r">Bid</th>
                    <th className="r">Ask</th>
                    <th className="r hide-sm">IV</th>
                    <th className="r hide-sm">Δ</th>
                  </tr>
                  <tr className="chain-sub">
                    <th colSpan={4} className="c up">Calls</th>
                    <th />
                    <th colSpan={4} className="c down">Puts</th>
                  </tr>
                </thead>
                <tbody>
                  {strikes.map((k) => {
                    const c = quote('call', k)
                    const p = quote('put', k)
                    const isSel = (t: OptionType, s: Side) => sel?.strike === k && sel.type === t && sel.side === s
                    return (
                      <tr key={k}>
                        <td className={cls('r mono hide-sm', k < spot && 'itm')}>{c.delta.toFixed(2)}</td>
                        <td className={cls('r mono hide-sm', k < spot && 'itm')}>{pct(c.iv, 1)}</td>
                        <td className={cls('r mono quote', k < spot && 'itm', isSel('call', 'sell') && 'picked')} onClick={() => pick('call', k, 'sell')}>
                          {num(c.bid)}
                        </td>
                        <td className={cls('r mono quote', k < spot && 'itm', isSel('call', 'buy') && 'picked')} onClick={() => pick('call', k, 'buy')}>
                          {num(c.ask)}
                        </td>
                        <td className="c mono strike-col">{num(k, k < 10 ? 2 : 0)}</td>
                        <td className={cls('r mono quote', k > spot && 'itm', isSel('put', 'sell') && 'picked')} onClick={() => pick('put', k, 'sell')}>
                          {num(p.bid)}
                        </td>
                        <td className={cls('r mono quote', k > spot && 'itm', isSel('put', 'buy') && 'picked')} onClick={() => pick('put', k, 'buy')}>
                          {num(p.ask)}
                        </td>
                        <td className={cls('r mono hide-sm', k > spot && 'itm')}>{pct(p.iv, 1)}</td>
                        <td className={cls('r mono hide-sm', k > spot && 'itm')}>{p.delta.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside className="card ticket">
          <h3>Order ticket</h3>
          {!sel || !selQuote ? (
            <p className="muted">Select a bid or ask from the chain to build an order.</p>
          ) : (
            <>
              <div className="seg full">
                <button className={cls(sel.side === 'buy' && 'active buy')} onClick={() => setSel({ ...sel, side: 'buy' })}>
                  Buy
                </button>
                <button className={cls(sel.side === 'sell' && 'active sell')} onClick={() => setSel({ ...sel, side: 'sell' })}>
                  Sell
                </button>
              </div>
              <div className="ticket-instrument">
                {symbol}-{expiry.label}-{sel.strike}-{sel.type === 'call' ? 'C' : 'P'}
              </div>
              <label className="field">
                <span>Contracts</span>
                <input type="number" min="0" step="0.1" value={size} onChange={(e) => setSize(e.target.value)} />
              </label>
              <dl className="kv">
                <dt>Price</dt>
                <dd className="mono">{usd(execPrice)}</dd>
                <dt>{sel.side === 'buy' ? 'Premium paid' : 'Premium received'}</dt>
                <dd className="mono">{usd(premium)}</dd>
                {sel.side === 'sell' && (
                  <>
                    <dt>Margin required</dt>
                    <dd className="mono">{usd(sel.strike * qty * 0.2)}</dd>
                  </>
                )}
                <dt>Breakeven</dt>
                <dd className="mono">{usd(breakeven)}</dd>
                <dt>IV</dt>
                <dd className="mono">{pct(selQuote.iv, 1)}</dd>
              </dl>
              <div className="greeks">
                <div>
                  <span>Δ</span>
                  <b className="mono">{(selQuote.delta * qty * (sel.side === 'buy' ? 1 : -1)).toFixed(3)}</b>
                </div>
                <div>
                  <span>Γ</span>
                  <b className="mono">{(selQuote.gamma * qty).toFixed(5)}</b>
                </div>
                <div>
                  <span>Θ/day</span>
                  <b className="mono">{(selQuote.theta * qty * (sel.side === 'buy' ? 1 : -1)).toFixed(2)}</b>
                </div>
                <div>
                  <span>Vega</span>
                  <b className="mono">{(selQuote.vega * qty).toFixed(2)}</b>
                </div>
              </div>
              <button className={cls('btn btn-lg full', sel.side === 'buy' ? 'btn-accent' : 'btn-sell')} onClick={submit} disabled={qty <= 0}>
                {sel.side === 'buy' ? 'Buy' : 'Sell'} {sel.type}
              </button>
            </>
          )}
          {msg && <div className={cls('notice', msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
          <div className="ticket-foot muted small">
            Available margin <span className="mono">{usd(account.cash)}</span>
          </div>
        </aside>
      </div>
      <PositionsPanel />
    </div>
  )
}
