import { useState } from 'react'
import { useReadContract, useReadContracts } from 'wagmi'
import { erc20Abi, formatUnits, parseUnits, zeroAddress, type Address } from 'viem'
import { ADDRESSES } from '../config/protocol'
import { IrmAbi, LLP_LLTV, MORPHO, MORPHO_IRM, MorphoAbi, llpMarket } from '../config/credit'
import { LarryPoolAbi } from '../lib/abis'
import { useProtocol } from '../lib/protocol'
import { useTx } from '../lib/tx'
import { useWallet } from '../lib/wallet'
import { cls, compactUsd, num, pct, usd } from '../lib/format'
import { NeedWallet, TxNotice } from './Status'

type Mode = 'collateral' | 'borrow' | 'repay' | 'remove' | 'lend' | 'unlend'
const LABEL: Record<Mode, string> = { collateral: 'Add LLP', borrow: 'Borrow', repay: 'Repay', remove: 'Remove LLP', lend: 'Lend', unlend: 'Withdraw' }
// Morpho's virtual shares: assets = shares x (totalAssets + 1) / (totalShares + 1e6)
const toAssets = (shares: bigint, totalAssets: bigint, totalShares: bigint, up = false) => {
  const n = shares * (totalAssets + 1n)
  const d = totalShares + 1_000_000n
  return up ? (n + d - 1n) / d : n / d
}

/** Borrow USDG against LLP on Morpho, or lend USDG to LLP holders. The market lives on Morpho Blue. */
export function LlpCredit() {
  const p = useProtocol()
  const w = useWallet()
  const tx = useTx()
  const m = llpMarket(undefined, p.token?.address)
  const [mode, setMode] = useState<Mode>('collateral')
  const [input, setInput] = useState('')
  const me = (w.address ?? zeroAddress) as Address
  const q = useReadContracts({
    allowFailure: true,
    contracts: m
      ? [
          { address: MORPHO, abi: MorphoAbi, functionName: 'market', args: [m.id] },
          { address: MORPHO, abi: MorphoAbi, functionName: 'position', args: [m.id, me] },
          { address: m.params.oracle, abi: [{ type: 'function', name: 'price', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const, functionName: 'price' },
          { address: ADDRESSES!.pool, abi: LarryPoolAbi, functionName: 'balanceOf', args: [me] },
          { address: m.params.loanToken, abi: erc20Abi, functionName: 'balanceOf', args: [me] },
        ]
      : [],
    query: { enabled: !!m, refetchInterval: 10_000 },
  })
  const mk = q.data?.[0]?.result as readonly [bigint, bigint, bigint, bigint, bigint, bigint] | undefined
  const pos = q.data?.[1]?.result as readonly [bigint, bigint, bigint] | undefined
  const price = (q.data?.[2]?.result as bigint | undefined) ?? 0n
  const llpBal = (q.data?.[3]?.result as bigint | undefined) ?? 0n
  const usdgBal = (q.data?.[4]?.result as bigint | undefined) ?? 0n
  const rate = useReadContract({
    address: MORPHO_IRM,
    abi: IrmAbi,
    functionName: 'borrowRateView',
    args: m && mk ? [m.params, { totalSupplyAssets: mk[0], totalSupplyShares: mk[1], totalBorrowAssets: mk[2], totalBorrowShares: mk[3], lastUpdate: mk[4], fee: mk[5] }] : undefined,
    query: { enabled: !!m && !!mk && mk[4] > 0n, refetchInterval: 30_000 },
  })

  if (!m || !p.token) return null
  const dec = p.token.decimals
  const llpDec = (p.token.decimals ?? 6) + 3
  const created = !!mk && mk[4] > 0n
  const supplied = mk?.[0] ?? 0n
  const borrowed = mk?.[2] ?? 0n
  const borrowApr = rate.data ? Number(rate.data) * 31_536_000 / 1e18 : 0
  const lendApr = supplied > 0n ? (borrowApr * Number(borrowed)) / Number(supplied) : 0
  const collateral = pos?.[2] ?? 0n
  const myDebt = mk && pos ? toAssets(pos[1], mk[2], mk[3], true) : 0n
  const myLent = mk && pos ? toAssets(pos[0], mk[0], mk[1]) : 0n
  const collValue = (collateral * price) / 10n ** 36n
  const maxDebt = (collValue * LLP_LLTV) / 10n ** 18n
  const ltv = collValue > 0n ? Number(myDebt) / Number(collValue) : 0
  const liquidity = supplied - borrowed

  const isLlp = mode === 'collateral' || mode === 'remove'
  let amount = 0n
  try {
    amount = parseUnits(input || '0', isLlp ? llpDec : dec)
  } catch {}
  const freeColl = price > 0n ? collateral - (myDebt * 10n ** 36n * 10n ** 18n) / (price * LLP_LLTV) : collateral
  const limit: Record<Mode, bigint> = {
    collateral: llpBal,
    borrow: maxDebt > myDebt ? (maxDebt - myDebt < liquidity ? maxDebt - myDebt : liquidity) : 0n,
    repay: myDebt < usdgBal ? myDebt : usdgBal,
    remove: freeColl > 0n ? freeColl : 0n,
    lend: usdgBal,
    unlend: myLent < liquidity ? myLent : liquidity,
  }

  const submit = () =>
    tx.run(`${LABEL[mode]} done`, async () => {
      const P = m.params
      if (mode === 'collateral') {
        await tx.ensureAllowance(P.collateralToken, me, MORPHO, amount, 'LLP')
        await tx.write('Add LLP', { address: MORPHO, abi: MorphoAbi, functionName: 'supplyCollateral', args: [P, amount, me, '0x'] })
      } else if (mode === 'remove') {
        await tx.write('Remove LLP', { address: MORPHO, abi: MorphoAbi, functionName: 'withdrawCollateral', args: [P, amount, me, me] })
      } else if (mode === 'borrow') {
        await tx.write('Borrow', { address: MORPHO, abi: MorphoAbi, functionName: 'borrow', args: [P, amount, 0n, me, me] })
      } else if (mode === 'repay') {
        // Repaying everything goes by shares so no dust is left behind.
        const all = amount >= myDebt
        await tx.ensureAllowance(P.loanToken, me, MORPHO, all ? myDebt + myDebt / 1000n + 1n : amount, p.token!.symbol)
        await tx.write('Repay', { address: MORPHO, abi: MorphoAbi, functionName: 'repay', args: all ? [P, 0n, pos![1], me, '0x'] : [P, amount, 0n, me, '0x'] })
      } else if (mode === 'lend') {
        await tx.ensureAllowance(P.loanToken, me, MORPHO, amount, p.token!.symbol)
        await tx.write('Lend', { address: MORPHO, abi: MorphoAbi, functionName: 'supply', args: [P, amount, 0n, me, '0x'] })
      } else {
        const all = amount >= myLent
        await tx.write('Withdraw', { address: MORPHO, abi: MorphoAbi, functionName: 'withdraw', args: all ? [P, 0n, pos![0], me, me] : [P, amount, 0n, me, me] })
      }
      setInput('')
    })

  return (
    <section className="credit">
      <div className="section-head">
        <div>
          <p className="eyebrow accent">Credit · on Morpho</p>
          <h2>Borrow against your LLP</h2>
          <p className="muted">
            Keep earning the vault's yield and borrow {p.token.symbol} against your LLP, up to {pct(Number(LLP_LLTV) / 1e18, 1)} of its value. Lenders earn the
            interest. The market runs on Morpho Blue; positions above the limit can be liquidated.
          </p>
        </div>
      </div>
      {!created ? (
        <div className="card muted">This market opens soon.</div>
      ) : (
        <div className="trade-layout">
          <div className="card">
            <div className="stat-grid credit-stats">
              <div>
                <div className="muted small">Lent</div>
                <div className="mono">{compactUsd(Number(formatUnits(supplied, dec)))}</div>
              </div>
              <div>
                <div className="muted small">Borrowed</div>
                <div className="mono">{compactUsd(Number(formatUnits(borrowed, dec)))}</div>
              </div>
              <div>
                <div className="muted small">Borrow APR</div>
                <div className="mono">{pct(borrowApr, 2)}</div>
              </div>
              <div>
                <div className="muted small">Lend APR</div>
                <div className="mono up">{pct(lendApr, 2)}</div>
              </div>
            </div>
            {w.address && (
              <dl className="kv credit-me">
                <dt>Your LLP posted</dt>
                <dd className="mono">
                  {num(Number(formatUnits(collateral, llpDec)))} LLP · {usd(Number(formatUnits(collValue, dec)))}
                </dd>
                <dt>Your debt</dt>
                <dd className="mono">{usd(Number(formatUnits(myDebt, dec)), 2)}</dd>
                <dt>Loan to value</dt>
                <dd className={cls('mono', ltv > 0.55 ? 'down' : '')}>
                  {pct(ltv, 1)} of {pct(Number(LLP_LLTV) / 1e18, 1)}
                </dd>
                <dt>Your lending</dt>
                <dd className="mono">{usd(Number(formatUnits(myLent, dec)), 2)}</dd>
              </dl>
            )}
          </div>
          <aside className="card ticket">
            <div className="seg full credit-modes">
              {(Object.keys(LABEL) as Mode[]).map((k) => (
                <button key={k} className={cls(mode === k && 'active')} onClick={() => (setMode(k), setInput(''))}>
                  {LABEL[k]}
                </button>
              ))}
            </div>
            <label className="field">
              <span>
                Amount ({isLlp ? 'LLP' : p.token.symbol})
                {w.address && (
                  <button className="link-btn" onClick={() => setInput(formatUnits(limit[mode], isLlp ? llpDec : dec))}>
                    Max {num(Number(formatUnits(limit[mode], isLlp ? llpDec : dec)))}
                  </button>
                )}
              </span>
              <input type="number" min="0" value={input} placeholder="0.00" onChange={(e) => setInput(e.target.value)} />
            </label>
            <NeedWallet />
            {w.address && w.onRobinhood && (
              <button className="btn btn-accent btn-lg full" onClick={submit} disabled={tx.busy || amount === 0n || amount > limit[mode]}>
                {amount > limit[mode] ? 'Amount too high' : LABEL[mode]}
              </button>
            )}
            <TxNotice status={tx.status} />
          </aside>
        </div>
      )}
    </section>
  )
}
