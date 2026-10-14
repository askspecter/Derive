import { useMemo } from 'react'
import { ASSETS, VAULTS } from '../config/markets'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { compactUsd } from '../lib/format'

function Bars({ data, label }: { data: number[]; label: string }) {
  const max = Math.max(...data)
  return (
    <div className="card">
      <h3>{label}</h3>
      <div className="bars">
        {data.map((d, i) => (
          <div key={i} className="bar-col" title={compactUsd(d)}>
            <div className="bar-fill" style={{ height: `${(d / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="bars-axis muted small">
        <span>30d ago</span>
        <span>Today</span>
      </div>
    </div>
  )
}

export function Stats() {
  const volume = useMemo(() => Array.from({ length: 30 }, (_, i) => 60e6 + 40e6 * Math.sin(i / 3) ** 2 + i * 3e6), [])
  const oi = useMemo(() => Array.from({ length: 30 }, (_, i) => 120e6 + i * 4.2e6 + 15e6 * Math.cos(i / 4)), [])
  const vaultTvl = VAULTS.reduce((s, v) => s + v.tvl, 0)
  return (
    <div className="app-page container">
      <div className="page-head">
        <div>
          <h1>Protocol stats</h1>
          <p className="muted">Illustrative metrics for the Larry protocol on Robinhood Chain.</p>
        </div>
      </div>
      <div className="stat-grid">
        <div className="card stat">
          <div className="muted small">24h volume</div>
          <div className="stat-value">{compactUsd(volume[29])}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Open interest</div>
          <div className="stat-value">{compactUsd(oi[29])}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Vault TVL</div>
          <div className="stat-value">{compactUsd(vaultTvl)}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Markets</div>
          <div className="stat-value">{ASSETS.length * 2}</div>
        </div>
      </div>
      <div className="two-col">
        <Bars data={volume} label="Daily volume" />
        <Bars data={oi} label="Open interest" />
      </div>
      <div className="card">
        <h3>Network</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Network</th>
                <th>Chain ID</th>
                <th className="hide-sm">RPC</th>
                <th>Explorer</th>
              </tr>
            </thead>
            <tbody>
              {[ROBINHOOD_CHAIN].map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="mono">{c.id}</td>
                  <td className="mono small hide-sm">{c.rpcUrl}</td>
                  <td>
                    <a className="link" href={c.explorerUrl} target="_blank" rel="noreferrer">
                      Open ↗
                    </a>
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
