import { useState } from 'react'
import { VAULTS, assetBySymbol, type Vault } from '../config/markets'
import { useAccount } from '../lib/account'
import { vaultValue } from '../lib/valuation'
import { AssetIcon } from '../components/AssetIcon'
import { cls, compactUsd, pct, usd } from '../lib/format'

function VaultCard({ v }: { v: Vault }) {
  const account = useAccount()
  const [amount, setAmount] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const pos = account.vaults.find((x) => x.vaultId === v.id)

  return (
    <div className="card vault">
      <div className="vault-top">
        <AssetIcon symbol={v.asset} size={36} />
        <span className={cls('tag', `risk-${v.risk.toLowerCase()}`)}>{v.risk} risk</span>
      </div>
      <div className="muted small">{v.strategy}</div>
      <h3>{v.name}</h3>
      <p className="muted small">{v.description}</p>
      <div className="vault-stats">
        <div>
          <div className="vault-apy">{pct(v.apy, 1)}</div>
          <div className="muted small">Est. APY</div>
        </div>
        <div>
          <div className="mono">{compactUsd(v.tvl)}</div>
          <div className="muted small">TVL</div>
        </div>
        <div>
          <div className="mono">{v.deposit}</div>
          <div className="muted small">Deposit</div>
        </div>
      </div>
      {pos && (
        <div className="vault-pos">
          <span className="muted small">Your position</span>
          <span className="mono">{usd(vaultValue(pos))}</span>
        </div>
      )}
      <div className="vault-form">
        <input type="number" placeholder="Amount (USD)" value={amount} min="0" onChange={(e) => setAmount(e.target.value)} />
        <button
          className="btn btn-accent"
          onClick={() => {
            const err = account.depositVault(v.id, parseFloat(amount) || 0)
            setMsg(err ? { ok: false, text: err } : { ok: true, text: 'Deposited' })
            if (!err) setAmount('')
          }}
        >
          Deposit
        </button>
        {pos && (
          <button className="btn btn-ghost" onClick={() => account.withdrawVault(v.id, vaultValue(pos))}>
            Withdraw
          </button>
        )}
      </div>
      {msg && <div className={cls('notice', msg.ok ? 'ok' : 'err')}>{msg.text}</div>}
    </div>
  )
}

export function Vaults() {
  const [filter, setFilter] = useState<'all' | 'crypto' | 'stock'>('all')
  const list = VAULTS.filter((v) => filter === 'all' || assetBySymbol(v.asset).kind === filter)
  const tvl = VAULTS.reduce((s, v) => s + v.tvl, 0)
  return (
    <div className="app-page container">
      <div className="page-head">
        <div>
          <h1>Vaults</h1>
          <p className="muted">Automated options strategies. Deposit once, the vault rolls positions every week.</p>
        </div>
        <div className="page-head-stat">
          <div className="stat-value">{compactUsd(tvl)}</div>
          <div className="muted small">Total vault TVL</div>
        </div>
      </div>
      <div className="seg">
        {(['all', 'crypto', 'stock'] as const).map((f) => (
          <button key={f} className={cls(filter === f && 'active')} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'crypto' ? 'Crypto' : 'Tokenized stocks'}
          </button>
        ))}
      </div>
      <div className="vault-grid">
        {list.map((v) => (
          <VaultCard key={v.id} v={v} />
        ))}
      </div>
    </div>
  )
}
