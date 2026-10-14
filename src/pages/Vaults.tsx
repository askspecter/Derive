import { useState } from 'react'
import { useReadContracts } from 'wagmi'
import { erc20Abi, formatUnits, parseUnits, zeroAddress, type Address } from 'viem'
import { ADDRESSES } from '../config/protocol'
import { NeedWallet, NotLive, TxNotice } from '../components/Status'
import { LarryPoolAbi } from '../lib/abis'
import { useProtocol } from '../lib/protocol'
import { useTx } from '../lib/tx'
import { useWallet } from '../lib/wallet'
import { cls, compactUsd, num, pct, usd } from '../lib/format'

export function Vaults() {
  const p = useProtocol()
  if (!p.deployed.pool) return <div className="app-page container"><NotLive /></div>
  const util = p.pool.totalAssets > 0n ? Number((p.pool.totalReserved * 10_000n) / p.pool.totalAssets) / 1e4 : 0
  const sym = p.token?.symbol ?? 'USDG'

  return (
    <div className="app-page container">
      <div className="page-head">
        <div>
          <p className="eyebrow accent">Earn</p>
          <h1>Larry Liquidity Vault</h1>
          <p className="muted">
            Deposit {sym} and become the counterparty to every trade on Larry. LPs earn trading fees, borrow fees, option
            premiums and trader losses, and pay out trader profits.
          </p>
        </div>
      </div>
      <div className="stat-grid">
        <div className="card stat">
          <div className="muted small">Total value locked</div>
          <div className="stat-value">{compactUsd(p.amount(p.pool.totalAssets))}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Reserved for open trades</div>
          <div className="stat-value">{compactUsd(p.amount(p.pool.totalReserved))}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Utilization</div>
          <div className="stat-value">{pct(util, 1)}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Deposit cap</div>
          <div className="stat-value">{compactUsd(p.amount(p.pool.depositCap))}</div>
        </div>
      </div>
      <div className="trade-layout">
        <div className="card">
          <h3>How the vault works</h3>
          <ul className="plain-list muted">
            <li>Your deposit mints LLP shares. Their value moves with the pool's results.</li>
            <li>Deposits are locked for {Math.round(p.pool.lockPeriod / 3600)} hours, then you can withdraw any time.</li>
            <li>Liquidity reserved for open positions can't be withdrawn until those positions close.</li>
            <li>When traders win, the pool pays them. LP returns can be negative.</li>
          </ul>
        </div>
        <VaultTicket />
      </div>
    </div>
  )
}

function VaultTicket() {
  const p = useProtocol()
  const w = useWallet()
  const tx = useTx()
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit')
  const [input, setInput] = useState('')
  const token = p.token
  const pool = ADDRESSES?.pool ?? zeroAddress
  const me = (w.address ?? zeroAddress) as Address

  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: token?.address ?? zeroAddress, abi: erc20Abi, functionName: 'balanceOf', args: [me] },
      { address: pool, abi: LarryPoolAbi, functionName: 'balanceOf', args: [me] },
      { address: pool, abi: LarryPoolAbi, functionName: 'maxWithdraw', args: [me] },
      { address: pool, abi: LarryPoolAbi, functionName: 'unlockAt', args: [me] },
      { address: pool, abi: LarryPoolAbi, functionName: 'maxDeposit', args: [me] },
    ],
    query: { enabled: !!w.address && !!token, refetchInterval: 10_000 },
  })
  const walletBal = (q.data?.[0]?.result as bigint | undefined) ?? 0n
  const shares = (q.data?.[1]?.result as bigint | undefined) ?? 0n
  const maxWithdraw = (q.data?.[2]?.result as bigint | undefined) ?? 0n
  const unlockAt = Number((q.data?.[3]?.result as bigint | undefined) ?? 0n)
  const maxDeposit = (q.data?.[4]?.result as bigint | undefined) ?? 0n

  const value = useReadContracts({
    contracts: [{ address: pool, abi: LarryPoolAbi, functionName: 'convertToAssets', args: [shares] }],
    query: { enabled: shares > 0n },
  })
  const positionValue = (value.data?.[0]?.result as bigint | undefined) ?? 0n

  if (!token) return null
  let amount = 0n
  try {
    amount = parseUnits(input || '0', token.decimals)
  } catch {}
  const limit = mode === 'deposit' ? (walletBal < maxDeposit ? walletBal : maxDeposit) : maxWithdraw
  const locked = unlockAt * 1000 > Date.now() && shares > 0n

  const submit = () =>
    tx.run(mode === 'deposit' ? 'Deposited' : 'Withdrawn', async () => {
      if (!w.address || !ADDRESSES) return
      if (mode === 'deposit') {
        await tx.ensureAllowance(token.address, me, ADDRESSES.pool, amount, token.symbol)
        await tx.write('Deposit', { address: ADDRESSES.pool, abi: LarryPoolAbi, functionName: 'deposit', args: [amount, me] })
      } else {
        await tx.write('Withdraw', { address: ADDRESSES.pool, abi: LarryPoolAbi, functionName: 'withdraw', args: [amount, me, me] })
      }
      setInput('')
    })

  return (
    <aside className="card ticket">
      <div className="seg full">
        <button className={cls(mode === 'deposit' && 'active')} onClick={() => setMode('deposit')}>
          Deposit
        </button>
        <button className={cls(mode === 'withdraw' && 'active')} onClick={() => setMode('withdraw')}>
          Withdraw
        </button>
      </div>
      {w.address && (
        <div className="vault-pos">
          <span className="muted small">Your position</span>
          <span className="mono">{usd(p.amount(positionValue))}</span>
        </div>
      )}
      <label className="field">
        <span>
          Amount ({token.symbol})
          {w.address && (
            <button className="link-btn" onClick={() => setInput(formatUnits(limit, token.decimals))}>
              Max {num(p.amount(limit))}
            </button>
          )}
        </span>
        <input type="number" min="0" value={input} placeholder="0.00" onChange={(e) => setInput(e.target.value)} />
      </label>
      {mode === 'withdraw' && locked && (
        <div className="notice pending">Unlocks {new Date(unlockAt * 1000).toLocaleString()}</div>
      )}
      <NeedWallet />
      {w.address && w.onRobinhood && (
        <button className="btn btn-accent btn-lg full" onClick={submit} disabled={tx.busy || amount === 0n || amount > limit || (mode === 'deposit' && p.pool.depositsPaused)}>
          {mode === 'deposit' && p.pool.depositsPaused ? 'Deposits paused' : amount > limit ? 'Amount too high' : mode === 'deposit' ? 'Deposit' : 'Withdraw'}
        </button>
      )}
      <TxNotice status={tx.status} />
    </aside>
  )
}
