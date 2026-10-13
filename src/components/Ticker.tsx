import { ASSETS } from '../config/markets'
import { useMarket } from '../lib/market'
import { AssetIcon } from './AssetIcon'
import { cls, num, signedPct } from '../lib/format'

export function Ticker() {
  const { prices, open24h } = useMarket()
  const items = [...ASSETS, ...ASSETS]
  return (
    <div className="ticker" aria-hidden>
      <div className="ticker-track">
        {items.map((a, i) => {
          const ch = prices[a.symbol] / open24h[a.symbol] - 1
          return (
            <span key={i} className="ticker-item">
              <AssetIcon symbol={a.symbol} size={18} />
              <b>{a.symbol}</b>
              <span className="mono">${num(prices[a.symbol])}</span>
              <span className={cls('mono', ch >= 0 ? 'up' : 'down')}>{signedPct(ch)}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
