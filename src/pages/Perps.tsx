import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { assetBySymbol } from '../config/markets'
import { AssetTabs } from '../components/AssetTabs'
import { PriceChart } from '../components/PriceChart'
import { PositionsPanel } from '../components/PositionsPanel'
import { useAccount } from '../lib/account'
import { useMarket } from '../lib/market'
import { perpLiquidation } from '../lib/valuation'
import { changePct, cls, compactUsd, num, usd } from '../lib/format'

function OrderBook({ mid }: { mid: number }) {
  // Synthetic depth around the oracle mid.
  const rows = useMemo(() => {
    const tick = mid * 0.0002
    const make = (dir: 1 | -1) =>
      Array.from({ length: 8 }, (_, i) => {
        const size = +(((Math.sin(i * 7.3 + mid) + 1.3) * 4) / Math.max(mid / 1000, 0.05)).toFixed(3)
        return { price: mid + dir * tick * (i + 1), size }
      })
    return { asks: make(1).reverse(), bids: make(-1) }
  }, [mid])
  const max = Math.max(...rows.asks.map((r) => r.size), ...rows.bids.map((r) => r.size))
  const digits = mid < 10 ? 4 : 2
  return (
    <div className="book mono small">
      <div className="book-head muted">
        <span>Price</span>
        <span className="r">Size</span>
      </div>
      {rows.asks.map((r) => (
        <div className="book-row" key={'a' + r.price}>
          <i className="bar ask" style={{ width: `${(r.size / max) * 100}%` }} />
          <span className="down">{num(r.price, digits)}</span>
          <span className="r">{num(r.size, 3)}</span>
        </div>
      ))}
      <div className="book-mid">{num(mid, digits)}</div>
      {rows.bids.map((r) => (
        <div className="book-row" key={'b' + r.price}>
          <i className="bar bid" style={{ width: `${(r.size / max) * 100}%` }} />
          <span className="up">{num(r.price, digits)}</span>
          <span className="r">{num(r.size, 3)}</span>
        </div>
      ))}
    </div>
  )
}

export function Perps() {
  const [params, setParams] = useSearchParams()
  const symbol = assetBySymbol(params.get('asset') ?? 'ETH').symbol
  const asset = assetBySymbol(symbol)
  const { prices, candles, open24h, funding } = useMarket()
  const account = useAccount()
  const mark = prices[symbol]
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [usdSize, setUsdSize] = useState('1000')
  const [lev, setLev] = useState(5)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const notional = Math.max(parseFloat(usdSize) || 0, 0)
  const size = notional / mark
  const margin = notional / lev
  const fee = notional * 0.0003
  const liq = perpLiquidation({ side, entry: mark, leverage: lev })
  const ch = mark / open24h[symbol] - 1

  const submit = () => {
    if (notional <= 0) return
    const err = account.openPerp({ asset: symbol, side, size, entry: mark, leverage: lev })
    setMsg(err ? { ok: false, text: err } : { ok: true, text: `${side === 'long' ? 'Long' : 'Short'} ${num(size, 4)} ${symbol} @ ${usd(mark)}` })
  }

  return (
    <div className="app-page">
      <AssetTabs value={symbol} onChange={(s) => setParams({ asset: s })} />
      <div className="trade-layout perps">
        <div className="trade-main">
          <div className="card">
            <div className="market-head">
              <div>
                <h2>
                  {symbol} PERP <span className="muted small">{asset.name}</span>
                </h2>
                <div className="mono big">{usd(mark)}</div>
              </div>
              <div className="market-meta">
                <div>
                  <div className="muted small">24h change</div>
                  <div className={cls('mono', ch >= 0 ? 'up' : 'down')}>{changePct(ch)}</div>
                </div>
                <div>
                  <div className="muted small">Funding / 1h</div>
                  <div className={cls('mono', funding[symbol] >= 0 ? 'up' : 'down')}>{changePct(funding[symbol], 4)}</div>
                </div>
                <div className="hide-sm">
                  <div className="muted small">Open interest</div>
                  <div className="mono">{compactUsd(asset.spot * 9_400 * (asset.kind === 'crypto' ? 1 : 0.4))}</div>
                </div>
              </div>
            </div>
            <PriceChart candles={candles[symbol]} height={340} />
          </div>
        </div>
        <div className="card book-card hide-md">
          <h3>Order book</h3>
          <OrderBook mid={mark} />
        </div>
        <aside className="card ticket">
          <div className="seg full">
            <button className={cls(side === 'long' && 'active buy')} onClick={() => setSide('long')}>
              Long
            </button>
            <button className={cls(side === 'short' && 'active sell')} onClick={() => setSide('short')}>
              Short
            </button>
          </div>
          <label className="field">
            <span>Size (USD)</span>
            <input type="number" min="0" value={usdSize} onChange={(e) => setUsdSize(e.target.value)} />
          </label>
          <label className="field">
            <span>
              Leverage <b className="mono">{lev}x</b>
            </span>
            <input type="range" min={1} max={20} value={lev} onChange={(e) => setLev(+e.target.value)} />
          </label>
          <dl className="kv">
            <dt>Size</dt>
            <dd className="mono">
              {num(size, 4)} {symbol}
            </dd>
            <dt>Margin</dt>
            <dd className="mono">{usd(margin)}</dd>
            <dt>Fee (0.03%)</dt>
            <dd className="mono">{usd(fee)}</dd>
            <dt>Est. liquidation</dt>
            <dd className="mono">{usd(liq)}</dd>
          </dl>
          <button className={cls('btn btn-lg full', side === 'long' ? 'btn-accent' : 'btn-sell')} onClick={submit} disabled={notional <= 0}>
            {side === 'long' ? 'Long' : 'Short'} {symbol}
          </button>
          {msg && <div className={cls('notice', msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
          <div className="ticket-foot muted small">
            Available margin <span className="mono">{usd(account.cash)}</span>
          </div>
        </aside>
      </div>
      <PositionsPanel initialTab="perps" />
    </div>
  )
}
