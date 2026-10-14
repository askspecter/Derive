import { Link } from 'react-router-dom'
import { VAULTS } from '../config/markets'
import { PositionsPanel } from '../components/PositionsPanel'
import { useAccount } from '../lib/account'
import { useMarket } from '../lib/market'
import { useWallet } from '../lib/wallet'
import { optionMark, optionPnl, perpPnl, vaultValue } from '../lib/valuation'
import { changeNum, changeUsd, cls, shortAddr, usd } from '../lib/format'

export function Portfolio() {
  const account = useAccount()
  const wallet = useWallet()
  const { prices } = useMarket()

  const optPnl = account.options.reduce((s, p) => s + optionPnl(p, optionMark(p, prices[p.asset])), 0)
  const prpPnl = account.perps.reduce((s, p) => s + perpPnl(p, prices[p.asset]), 0)
  const optValue = account.options.reduce((s, p) => {
    const mark = optionMark(p, prices[p.asset])
    return s + (p.side === 'buy' ? mark * p.size : p.strike * p.size * 0.2 - mark * p.size)
  }, 0)
  const perpValue = account.perps.reduce((s, p) => s + (p.size * p.entry) / p.leverage + perpPnl(p, prices[p.asset]), 0)
  const vaultTotal = account.vaults.reduce((s, v) => s + vaultValue(v), 0)
  const equity = account.cash + optValue + perpValue + vaultTotal
  const netDelta =
    account.options.reduce((s, p) => s + (p.side === 'buy' ? 1 : -1) * p.size * (p.type === 'call' ? 0.5 : -0.5), 0) +
    account.perps.reduce((s, p) => s + (p.side === 'long' ? 1 : -1) * p.size, 0)

  return (
    <div className="app-page container">
      <div className="page-head">
        <div>
          <h1>Portfolio</h1>
          <p className="muted">
            {wallet.address ? (
              <>
                Subaccount for <span className="mono">{shortAddr(wallet.address)}</span>
              </>
            ) : (
              'Guest paper account. Connect a wallet to keep a subaccount per address.'
            )}
          </p>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => {
            if (confirm('Reset paper account to the starting balance?')) account.reset()
          }}
        >
          Reset paper account
        </button>
      </div>

      <div className="stat-grid">
        <div className="card stat">
          <div className="muted small">Account equity</div>
          <div className="stat-value">{usd(equity)}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Free margin</div>
          <div className="stat-value">{usd(account.cash)}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Unrealized PnL</div>
          <div className={cls('stat-value', optPnl + prpPnl >= 0 ? 'up' : 'down')}>{changeUsd(optPnl + prpPnl)}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Vaults</div>
          <div className="stat-value">{usd(vaultTotal)}</div>
        </div>
      </div>

      <PositionsPanel />

      <div className="card">
        <h3>Vault positions</h3>
        {account.vaults.length === 0 ? (
          <p className="empty muted">
            No vault deposits. <Link to="/vaults" className="link">Browse vaults →</Link>
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Vault</th>
                  <th className="r">Deposited</th>
                  <th className="r">Value</th>
                  <th className="r">Earned</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {account.vaults.map((v) => {
                  const value = vaultValue(v)
                  return (
                    <tr key={v.vaultId}>
                      <td>{VAULTS.find((x) => x.id === v.vaultId)?.name ?? v.vaultId}</td>
                      <td className="r mono">{usd(v.amount)}</td>
                      <td className="r mono">{usd(value)}</td>
                      <td className="r mono up">{usd(value - v.amount, 4)}</td>
                      <td className="r">
                        <button className="btn btn-sm btn-ghost" onClick={() => account.withdrawVault(v.vaultId, value)}>
                          Withdraw
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted small">Approximate net delta in contracts and units: {changeNum(netDelta)}</p>
    </div>
  )
}
