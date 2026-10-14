import { ASSETS } from '../config/markets'
import { useProtocol } from '../lib/protocol'
import { AssetIcon } from './AssetIcon'
import { cls, num } from '../lib/format'

/** Asset switcher. `listed` says which markets are live for the current product. */
export function AssetTabs({ value, onChange, listed }: { value: string; onChange(s: string): void; listed: boolean[] }) {
  const { prices } = useProtocol()
  const anyListed = listed.some(Boolean)
  return (
    <div className="asset-tabs">
      {ASSETS.map((a, i) => {
        // Once markets are live, only listed ones are shown (plus the one being viewed).
        if (anyListed && !listed[i] && a.symbol !== value) return null
        const p = prices[a.symbol]
        return (
          <button key={a.symbol} className={cls('asset-tab', value === a.symbol && 'active', !listed[i] && 'unlisted')} onClick={() => onChange(a.symbol)}>
            <AssetIcon symbol={a.symbol} size={20} />
            <span className="asset-sym">{a.symbol}</span>
            {a.kind === 'stock' && <span className="tag">{a.tag ?? 'Stock'}</span>}
            {listed[i] && p ? (
              <span className={cls('mono small', p.stale && 'muted')}>{num(p.price, p.price < 10 ? 4 : 2)}</span>
            ) : (
              <span className="muted small">Soon</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
