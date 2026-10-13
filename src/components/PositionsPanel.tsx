import { useState } from 'react'
import { useAccount } from '../lib/account'
import { useMarket } from '../lib/market'
import { optionMark, optionPnl, perpLiquidation, perpPnl } from '../lib/valuation'
import { cls, num, usd } from '../lib/format'

export function PositionsPanel({ initialTab = 'options' }: { initialTab?: 'options' | 'perps' | 'history' }) {
  const account = useAccount()
  const { prices } = useMarket()
  const [tab, setTab] = useState(initialTab)

  return (
    <div className="card positions">
      <div className="seg">
        <button className={cls(tab === 'options' && 'active')} onClick={() => setTab('options')}>
          Options ({account.options.length})
        </button>
        <button className={cls(tab === 'perps' && 'active')} onClick={() => setTab('perps')}>
          Perps ({account.perps.length})
        </button>
        <button className={cls(tab === 'history' && 'active')} onClick={() => setTab('history')}>
          History
        </button>
      </div>
      <div className="table-wrap">
        {tab === 'options' &&
          (account.options.length === 0 ? (
            <p className="empty muted">No open option positions.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Side</th>
                  <th className="r">Size</th>
                  <th className="r">Entry</th>
                  <th className="r">Mark</th>
                  <th className="r">PnL</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {account.options.map((p) => {
                  const mark = optionMark(p, prices[p.asset])
                  const pnl = optionPnl(p, mark)
                  return (
                    <tr key={p.id}>
                      <td className="mono">
                        {p.asset}-{new Date(p.expiry).toISOString().slice(5, 10)}-{p.strike}-{p.type === 'call' ? 'C' : 'P'}
                      </td>
                      <td className={p.side === 'buy' ? 'up' : 'down'}>{p.side === 'buy' ? 'Long' : 'Short'}</td>
                      <td className="r mono">{num(p.size)}</td>
                      <td className="r mono">{usd(p.entry)}</td>
                      <td className="r mono">{usd(mark)}</td>
                      <td className={cls('r mono', pnl >= 0 ? 'up' : 'down')}>{usd(pnl)}</td>
                      <td className="r">
                        <button className="btn btn-sm btn-ghost" onClick={() => account.closeOption(p.id, mark)}>
                          Close
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ))}
        {tab === 'perps' &&
          (account.perps.length === 0 ? (
            <p className="empty muted">No open perp positions.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Side</th>
                  <th className="r">Size</th>
                  <th className="r">Entry</th>
                  <th className="r">Mark</th>
                  <th className="r hide-sm">Liq. price</th>
                  <th className="r">PnL</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {account.perps.map((p) => {
                  const mark = prices[p.asset]
                  const pnl = perpPnl(p, mark)
                  return (
                    <tr key={p.id}>
                      <td className="mono">
                        {p.asset}-PERP <span className="tag">{p.leverage}x</span>
                      </td>
                      <td className={p.side === 'long' ? 'up' : 'down'}>{p.side === 'long' ? 'Long' : 'Short'}</td>
                      <td className="r mono">{num(p.size, 4)}</td>
                      <td className="r mono">{usd(p.entry)}</td>
                      <td className="r mono">{usd(mark)}</td>
                      <td className="r mono hide-sm">{usd(perpLiquidation(p))}</td>
                      <td className={cls('r mono', pnl >= 0 ? 'up' : 'down')}>{usd(pnl)}</td>
                      <td className="r">
                        <button className="btn btn-sm btn-ghost" onClick={() => account.closePerp(p.id, mark)}>
                          Close
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ))}
        {tab === 'history' &&
          (account.history.length === 0 ? (
            <p className="empty muted">No trades yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Instrument</th>
                  <th>Side</th>
                  <th className="r">Size</th>
                  <th className="r">Price</th>
                </tr>
              </thead>
              <tbody>
                {account.history.map((t) => (
                  <tr key={t.id}>
                    <td className="mono small">{new Date(t.at).toLocaleString()}</td>
                    <td className="mono">{t.label}</td>
                    <td>{t.side}</td>
                    <td className="r mono">{num(t.size, 4)}</td>
                    <td className="r mono">{usd(t.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </div>
    </div>
  )
}
