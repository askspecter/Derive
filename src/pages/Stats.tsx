import { ASSETS } from '../config/markets'
import { ADDRESSES, ADMIN } from '../config/protocol'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { AssetIcon } from '../components/AssetIcon'
import { NotLive } from '../components/Status'
import { useProtocol } from '../lib/protocol'
import { compactUsd, num, shortAddr } from '../lib/format'

const link = (a: string) => `${ROBINHOOD_CHAIN.explorerUrl}/address/${a}`

export function Stats() {
  const p = useProtocol()
  if (!p.deployed.pool) return <div className="app-page container"><NotLive /></div>
  const oiTotal = p.perps.oiLong.reduce((s, v) => s + v, 0n) + p.perps.oiShort.reduce((s, v) => s + v, 0n)
  const notional = p.options.openNotional.reduce((s, v) => s + v, 0n)
  const listed = ASSETS.filter((_, i) => p.perps.markets[i]?.enabled || p.options.markets[i]?.enabled).length

  return (
    <div className="app-page container">
      <div className="page-head">
        <div>
          <h1>Protocol stats</h1>
          <p className="muted">Live from the Larry contracts on Robinhood Chain.</p>
        </div>
      </div>
      <div className="stat-grid">
        <div className="card stat">
          <div className="muted small">Vault TVL</div>
          <div className="stat-value">{compactUsd(p.amount(p.pool.totalAssets))}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Perps open interest</div>
          <div className="stat-value">{compactUsd(p.amount(oiTotal))}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Options open notional</div>
          <div className="stat-value">{compactUsd(p.amount(notional))}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Markets listed</div>
          <div className="stat-value">{listed}</div>
        </div>
      </div>
      <div className="card">
        <h3>Markets</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="r">Oracle price</th>
                <th className="r">Long OI</th>
                <th className="r">Short OI</th>
                <th className="r">Options notional</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ASSETS.map((a, i) => {
                const px = p.prices[a.symbol]
                const live = p.perps.markets[i]?.enabled || p.options.markets[i]?.enabled
                return (
                  <tr key={a.symbol}>
                    <td>
                      <span className="asset-cell">
                        <AssetIcon symbol={a.symbol} size={22} />
                        <b>{a.symbol}</b>
                      </span>
                    </td>
                    <td className="r mono">{px ? `$${num(px.price)}` : ''}</td>
                    <td className="r mono">{compactUsd(p.amount(p.perps.oiLong[i]))}</td>
                    <td className="r mono">{compactUsd(p.amount(p.perps.oiShort[i]))}</td>
                    <td className="r mono">{compactUsd(p.amount(p.options.openNotional[i]))}</td>
                    <td>{live ? (px?.stale ? 'Market closed' : 'Live') : 'Not listed'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h3>Contracts</h3>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {[
                ['LarryPool (LLP vault)', ADDRESSES!.pool],
                ['LarryPerps', ADDRESSES!.perps],
                ['LarryOptions', ADDRESSES!.options],
                [`Collateral (${p.token?.symbol ?? 'USDG'})`, p.token?.address ?? ''],
                ['Admin', ADMIN ?? ''],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td className="r">
                    {v && (
                      <a className="link mono" href={link(v)} target="_blank" rel="noreferrer">
                        {shortAddr(v)} ↗
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
