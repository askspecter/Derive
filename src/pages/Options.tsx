import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useConfig, useReadContract, useReadContracts } from 'wagmi'
import { readContract } from 'wagmi/actions'
import { formatUnits, parseUnits, zeroAddress, type Address } from 'viem'
import { ASSETS, assetBySymbol } from '../config/markets'
import { ADDRESSES, marketIdOf } from '../config/protocol'
import { AssetTabs } from '../components/AssetTabs'
import { PriceChart } from '../components/PriceChart'
import { NeedWallet, NotLive, TxNotice } from '../components/Status'
import { LarryOptionsAbi, aggregatorAbi } from '../lib/abis'
import { blackScholes, contractPremium } from '../lib/blackScholes'
import { strikesAround, validExpiries } from '../lib/expiries'
import { useFeedHistory } from '../lib/history'
import { useProtocol, type OptionMarket } from '../lib/protocol'
import { useTx } from '../lib/tx'
import { useWallet } from '../lib/wallet'
import { cls, compactUsd, dateLabel, num, pct, usd } from '../lib/format'

const YEAR = 365 * 86400

interface Selection {
  isCall: boolean
  strike: number
}

export function Options() {
  const [params, setParams] = useSearchParams()
  const symbol = assetBySymbol(params.get('asset') ?? 'ETH').symbol
  const asset = assetBySymbol(symbol)
  const p = useProtocol()
  const idx = Number(marketIdOf(symbol))
  const market = p.options.markets[idx]
  const price = p.prices[symbol]
  const history = useFeedHistory(market?.feed, price?.roundId, 8, 80)
  const listed = p.options.markets.map((m) => !!m?.enabled)

  if (!p.live) return <div className="app-page container"><NotLive /></div>

  return (
    <div className="app-page">
      <AssetTabs value={symbol} onChange={(s) => setParams({ asset: s })} listed={listed} />
      {!market?.enabled ? (
        <div className="card not-live">
          <p className="eyebrow accent">{symbol} options</p>
          <h2>Not listed yet</h2>
          <p className="muted">This market has no options listing yet. Pick another asset above.</p>
        </div>
      ) : (
        <>
          <div className="trade-main">
              <div className="card">
                <div className="market-head">
                  <div>
                    <h2>
                      {symbol} Options <span className="muted small">{asset.name}</span>
                    </h2>
                    <div className="mono big">{price ? usd(price.price) : 'Loading'}</div>
                    {price?.stale && <div className="tag warn-tag">Oracle stale, market closed</div>}
                  </div>
                  <div className="market-meta">
                    <div>
                      <div className="muted small">Implied vol</div>
                      <div className="mono">{pct(Number(formatUnits(market.vol, 18)), 1)}</div>
                    </div>
                    <div>
                      <div className="muted small">Open notional</div>
                      <div className="mono">{compactUsd(p.amount(p.options.openNotional[idx]))}</div>
                    </div>
                  </div>
                </div>
                <PriceChart points={history} height={220} />
              </div>
              {price && <Chain symbol={symbol} idx={idx} market={market} spot={price.price} />}
          </div>
          <OptionPositions />
        </>
      )}
    </div>
  )
}

function Chain({ symbol, idx, market, spot }: { symbol: string; idx: number; market: OptionMarket; spot: number }) {
  const expiries = useMemo(() => validExpiries(market.maxExpiry), [market.maxExpiry])
  const [expIdx, setExpIdx] = useState(0)
  const [sel, setSel] = useState<Selection | null>(null)
  const expiry = expiries[Math.min(expIdx, expiries.length - 1)]
  // Strikes anchored to a rounded spot so the grid doesn't jump on every update.
  const anchor = useMemo(() => Number(spot.toPrecision(2)), [Math.round(Math.log(spot) * 20)]) // eslint-disable-line react-hooks/exhaustive-deps
  const strikes = useMemo(() => strikesAround(anchor), [anchor])
  const vol = Number(formatUnits(market.vol, 18))

  if (!expiry) return <div className="card">No expiries available.</div>
  const years = expiry.days / 365
  const q = (isCall: boolean, k: number) => ({
    ask: contractPremium(isCall, spot, k, years, vol, market.spreadBps, market.minPremiumBps),
    delta: blackScholes(isCall, spot, k, years, vol).delta,
  })

  return (
    <div className="trade-layout">
      <div className="card">
        <div className="chain-head">
          <div className="seg">
            {expiries.map((e, i) => (
              <button key={e.ts} className={cls(e.ts === expiry.ts && 'active')} onClick={() => setExpIdx(i)}>
                {e.label}
              </button>
            ))}
          </div>
          <div className="muted small">Click a price to buy. Expiry 08:00 UTC.</div>
        </div>
        <div className="table-wrap">
          <table className="table chain">
            <thead>
              <tr>
                <th className="r hide-sm">Δ</th>
                <th className="r">Call</th>
                <th className="c strike-col">Strike</th>
                <th className="r">Put</th>
                <th className="r hide-sm">Δ</th>
              </tr>
            </thead>
            <tbody>
              {strikes.map((k) => {
                const c = q(true, k)
                const pu = q(false, k)
                const picked = (isCall: boolean) => sel?.strike === k && sel.isCall === isCall
                return (
                  <tr key={k}>
                    <td className={cls('r mono hide-sm', k < spot && 'itm')}>{c.delta.toFixed(2)}</td>
                    <td className={cls('r mono quote', k < spot && 'itm', picked(true) && 'picked')} onClick={() => setSel({ isCall: true, strike: k })}>
                      {num(c.ask)}
                    </td>
                    <td className="c mono strike-col">{num(k, k < 10 ? 2 : 0)}</td>
                    <td className={cls('r mono quote', k > spot && 'itm', picked(false) && 'picked')} onClick={() => setSel({ isCall: false, strike: k })}>
                      {num(pu.ask)}
                    </td>
                    <td className={cls('r mono hide-sm', k > spot && 'itm')}>{Math.abs(pu.delta).toFixed(2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      <OptionTicket symbol={symbol} idx={idx} expiry={expiry.ts} sel={sel} spot={spot} market={market} />
    </div>
  )
}

function OptionTicket(props: { symbol: string; idx: number; expiry: number; sel: Selection | null; spot: number; market: OptionMarket }) {
  const { symbol, idx, expiry, sel, spot, market } = props
  const p = useProtocol()
  const w = useWallet()
  const tx = useTx()
  const [amountIn, setAmountIn] = useState('1')
  const token = p.token!
  let amount = 0n
  try {
    amount = parseUnits(amountIn || '0', 18)
  } catch {}
  const strikeWad = sel ? parseUnits(String(sel.strike), 18) : 0n

  const quote = useReadContract({
    address: ADDRESSES?.options,
    abi: LarryOptionsAbi,
    functionName: 'quote',
    args: [BigInt(idx), sel?.isCall ?? true, strikeWad, BigInt(expiry), amount],
    query: { enabled: !!sel && amount > 0n, refetchInterval: 10_000 },
  })
  const [premium, fee, maxPayout] = quote.data ?? [0n, 0n, 0n]
  const cost = premium + fee
  const years = (expiry - Date.now() / 1000) / YEAR
  const greeks = sel ? blackScholes(sel.isCall, spot, sel.strike, years, Number(formatUnits(market.vol, 18))) : null
  const perUnit = amount > 0n ? p.amount(premium) / Number(formatUnits(amount, 18)) : 0
  const breakeven = sel ? (sel.isCall ? sel.strike + perUnit : sel.strike - perUnit) : 0

  const submit = () =>
    tx.run(`Bought ${symbol} option`, async () => {
      if (!w.address || !ADDRESSES || !sel) return
      const maxCost = (cost * 101n) / 100n // 1% headroom for price moves between quote and block
      await tx.ensureAllowance(token.address, w.address as Address, ADDRESSES.options, maxCost, token.symbol)
      await tx.write('Buy option', {
        address: ADDRESSES.options,
        abi: LarryOptionsAbi,
        functionName: 'buy',
        args: [BigInt(idx), sel.isCall, strikeWad, BigInt(expiry), amount, maxCost],
      })
    })

  return (
    <aside className="card ticket">
      <h3>Buy option</h3>
      {!sel ? (
        <p className="muted">Pick a call or put price from the chain.</p>
      ) : (
        <>
          <div className="ticket-instrument">
            {symbol} {dateLabel(expiry * 1000).toUpperCase()} {sel.strike} {sel.isCall ? 'CALL' : 'PUT'}
          </div>
          <label className="field">
            <span>Contracts ({symbol})</span>
            <input type="number" min="0" step="0.1" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} />
          </label>
          <dl className="kv">
            <dt>Premium</dt>
            <dd className="mono">{quote.isError ? 'Unavailable' : usd(p.amount(premium))}</dd>
            <dt>Protocol fee</dt>
            <dd className="mono">{usd(p.amount(fee))}</dd>
            <dt>Total cost</dt>
            <dd className="mono">{usd(p.amount(cost))}</dd>
            <dt>Breakeven</dt>
            <dd className="mono">{usd(breakeven)}</dd>
            <dt>Max payout</dt>
            <dd className="mono">{usd(p.amount(maxPayout))}</dd>
            <dt>Delta</dt>
            <dd className="mono">{greeks ? Math.abs(greeks.delta).toFixed(3) : ''}</dd>
          </dl>
          <NeedWallet />
          {w.address && w.onRobinhood && (
            <button className="btn btn-accent btn-lg full" onClick={submit} disabled={tx.busy || !quote.data || p.options.paused}>
              {p.options.paused ? 'Trading paused' : `Buy ${sel.isCall ? 'call' : 'put'}`}
            </button>
          )}
          {quote.isError && <div className="notice err">Quote unavailable. The oracle may be stale or the strike out of range.</div>}
        </>
      )}
      <TxNotice status={tx.status} />
    </aside>
  )
}

interface OptionRow {
  owner: Address
  marketId: number
  isCall: boolean
  exercised: boolean
  expiry: bigint
  strike: bigint
  amount: bigint
  premium: bigint
  maxPayout: bigint
}

export function OptionPositions() {
  const p = useProtocol()
  const w = useWallet()
  const tx = useTx()
  const config = useConfig()
  const options = ADDRESSES?.options ?? zeroAddress
  const ids = useReadContract({
    address: options,
    abi: LarryOptionsAbi,
    functionName: 'optionIdsOf',
    args: [(w.address ?? zeroAddress) as Address],
    query: { enabled: !!w.address, refetchInterval: 15_000 },
  })
  const list = [...(ids.data ?? [])].reverse()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls: any[] = list.flatMap((id) => [
    { address: options, abi: LarryOptionsAbi, functionName: 'getOption', args: [id] },
    { address: options, abi: LarryOptionsAbi, functionName: 'payoutOf', args: [id] },
  ])
  const rows = useReadContracts({ allowFailure: true, contracts: calls, query: { enabled: list.length > 0, refetchInterval: 15_000 } })
  const opts = list.map((id, i) => ({ id, o: rows.data?.[2 * i]?.result as OptionRow | undefined, payout: rows.data?.[2 * i + 1]?.result as bigint | undefined }))
  const settledQ = useReadContracts({
    allowFailure: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    contracts: opts.map(({ o }) => ({ address: options, abi: LarryOptionsAbi, functionName: 'settlementPrice', args: [BigInt(o?.marketId ?? 0), o?.expiry ?? 0n] })) as any[],
    query: { enabled: opts.length > 0, refetchInterval: 15_000 },
  })
  const nowS = Date.now() / 1000

  /** Finds the first round at or after expiry by walking back from the latest round. */
  async function findSettlementRound(feed: Address, expiry: bigint): Promise<bigint> {
    const [latest] = await readContract(config, { address: feed, abi: aggregatorAbi, functionName: 'latestRoundData' })
    let id = latest
    for (let i = 0; i < 5000 && id > 1n; i++) {
      const [, , , updatedAt] = await readContract(config, { address: feed, abi: aggregatorAbi, functionName: 'getRoundData', args: [id - 1n] })
      if (updatedAt < expiry) return id
      id -= 1n
    }
    throw new Error('Could not find the settlement round. Try again later.')
  }

  const settleAndClaim = (id: bigint, o: OptionRow, settled: boolean) =>
    tx.run('Payout claimed', async () => {
      if (!settled) {
        const feed = p.options.markets[o.marketId]?.feed
        if (!feed) throw new Error('Market has no feed')
        tx.setStatus({ kind: 'pending', label: 'Finding the settlement price' })
        const round = await findSettlementRound(feed, o.expiry)
        await tx.write('Settle expiry', { address: options, abi: LarryOptionsAbi, functionName: 'settle', args: [BigInt(o.marketId), o.expiry, round] })
      }
      await tx.write('Claim', { address: options, abi: LarryOptionsAbi, functionName: 'exercise', args: [id] })
    })

  return (
    <div className="card positions">
      <h3>Your options</h3>
      {!w.address ? (
        <p className="empty muted">Connect a wallet to see your options.</p>
      ) : list.length === 0 ? (
        <p className="empty muted">No options yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Option</th>
                <th className="r">Contracts</th>
                <th className="r">Paid</th>
                <th>Status</th>
                <th className="r">Payout</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {opts.map(({ id, o, payout }, i) => {
                if (!o) return null
                const sym = ASSETS[o.marketId]?.symbol ?? '?'
                const settlePx = settledQ.data?.[i]?.result as bigint | undefined
                const settled = !!settlePx && settlePx > 0n
                const expired = Number(o.expiry) <= nowS
                const status = o.exercised ? 'Closed' : settled ? `Settled at ${usd(Number(formatUnits(settlePx!, 18)))}` : expired ? 'Awaiting settlement' : 'Active'
                return (
                  <tr key={String(id)}>
                    <td className="mono">
                      {sym} {dateLabel(Number(o.expiry) * 1000).toUpperCase()} {num(Number(formatUnits(o.strike, 18)), 2)} {o.isCall ? 'C' : 'P'}
                    </td>
                    <td className="r mono">{num(Number(formatUnits(o.amount, 18)), 3)}</td>
                    <td className="r mono">{usd(p.amount(o.premium))}</td>
                    <td>{status}</td>
                    <td className="r mono">{settled || o.exercised ? usd(p.amount(payout ?? 0n)) : ''}</td>
                    <td className="r">
                      {!o.exercised && expired && (
                        <button className="btn btn-sm btn-accent" disabled={tx.busy} onClick={() => settleAndClaim(id, o, settled)}>
                          {settled ? 'Claim' : 'Settle and claim'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <TxNotice status={tx.status} />
    </div>
  )
}
