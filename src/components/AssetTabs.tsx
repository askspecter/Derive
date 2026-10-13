import { ASSETS } from '../config/markets'
import { useMarket } from '../lib/market'
import { AssetIcon } from './AssetIcon'
import { cls, num, signedPct } from '../lib/format'

export function AssetTabs({ value, onChange }: { value: string; onChange(s: string): void }) {
  const { prices, open24h } = useMarket()
  return (
    <div className="asset-tabs">
      {ASSETS.map((a) => {
        const ch = prices[a.symbol] / open24h[a.symbol] - 1
        return (
          <button key={a.symbol} className={cls('asset-tab', value === a.symbol && 'active')} onClick={() => onChange(a.symbol)}>
            <AssetIcon symbol={a.symbol} size={20} />
            <span className="asset-sym">{a.symbol}</span>
            {a.kind === 'stock' && <span className="tag">Stock</span>}
            <span className="mono small">{num(prices[a.symbol], prices[a.symbol] < 10 ? 4 : 2)}</span>
            <span className={cls('mono small', ch >= 0 ? 'up' : 'down')}>{signedPct(ch)}</span>
          </button>
        )
      })}
    </div>
  )
}
