import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useReadContract, useReadContracts } from 'wagmi'
import { erc20Abi, formatUnits, parseUnits, zeroAddress, type Address } from 'viem'
import { ASSETS, assetBySymbol } from '../config/markets'
import { ADDRESSES, marketIdOf } from '../config/protocol'
import { AssetTabs } from '../components/AssetTabs'
import { PriceChart } from '../components/PriceChart'
import { NeedWallet, NotLive, TxNotice } from '../components/Status'
import { LarryPerpsAbi } from '../lib/abis'
import { useFeedHistory } from '../lib/history'
import { useProtocol } from '../lib/protocol'
import { useTx } from '../lib/tx'
import { useWallet } from '../lib/wallet'
import { changeUsd, cls, compactUsd, num, pct, usd } from '../lib/format'

const SLIPPAGE_BPS = 50n // 0.5%

export function Perps() {
  const [params, setParams] = useSearchParams()
  const symbol = assetBySymbol(params.get('asset') ?? 'ETH').symbol
  const asset = assetBySymbol(symbol)
  const p = useProtocol()
  const idx = Number(marketIdOf(symbol))
  const market = p.perps.markets[idx]
  const price = p.prices[symbol]
  const history = useFeedHistory(market?.feed, price?.roundId, 8, 80)
  const listed = p.perps.markets.map((m) => !!m?.enabled)

  if (!p.live) return <div className="app-page container"><NotLive /></div>

  return (
    <div className="app-page">
      <AssetTabs value={symbol} onChange={(s) => setParams({ asset: s })} listed={listed} />
      {!market?.enabled ? (
        <div className="card not-live">
          <p className="eyebrow accent">{symbol} PERP</p>
          <h2>Not listed yet</h2>
          <p className="muted">This market has no perpetual listing yet. Pick another asset above.</p>
        </div>
      ) : (
        <>
          <div className="trade-layout">
            <div className="trade-main">
              <div className="card">
                <div className="market-head">
                  <div>
                    <h2>
                      {symbol} PERP <span className="muted small">{asset.name}</span>
                    </h2>
                    <div className="mono big">{price ? usd(price.price) : 'Loading'}</div>
                    {price?.stale && <div className="tag warn-tag">Oracle stale, market closed</div>}
                  </div>
                  <div className="market-meta">
                    <div>
                      <div className="muted small">Long OI</div>
                      <div className="mono">{compactUsd(p.amount(p.perps.oiLong[idx]))}</div>
                    </div>
                    <div>
                      <div className="muted small">Short OI</div>
                      <div className="mono">{compactUsd(p.amount(p.perps.oiShort[idx]))}</div>
                    </div>
                    <div className="hide-sm">
                      <div className="muted small">Borrow / day</div>
                      <div className="mono">{pct(market.borrowBpsPerDay / 1e4, 3)}</div>
                    </div>
                  </div>
                </div>
                <PriceChart points={history} height={320} />
              </div>
              <MarketInfo idx={idx} />
            </div>
            <PerpTicket symbol={symbol} idx={idx} />
          </div>
          <PerpPositions />
        </>
      )}
    </div>
  )
}

function MarketInfo({ idx }: { idx: number }) {
  const p = useProtocol()
  const m = p.perps.markets[idx]!
  const rows: [string, string][] = [
    ['Max leverage', `${m.maxLeverage}x`],
    ['Open fee', pct(m.openFeeBps / 1e4, 2)],
    ['Close fee', pct(m.closeFeeBps / 1e4, 2)],
    ['Borrow fee', `${pct(m.borrowBpsPerDay / 1e4, 3)} per day`],
    ['Maintenance margin', pct(m.maintenanceBps / 1e4, 2)],
    ['Max profit', `${m.maxProfitMultiple}x collateral`],
    ['OI cap per side', compactUsd(p.amount(m.maxOpenInterest))],
    ['Pool liquidity free', compactUsd(p.amount(p.pool.freeLiquidity))],
  ]
  return (
    <div className="card">
      <h3>Market rules</h3>
      <dl className="kv info-grid">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function PerpTicket({ symbol, idx }: { symbol: string; idx: number }) {
  const p = useProtocol()
  const w = useWallet()
  const tx = useTx()
  const m = p.perps.markets[idx]!
  const price = p.prices[symbol]
  const token = p.token!
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [collateralIn, setCollateralIn] = useState('100')
  const [lev, setLev] = useState(Math.min(5, m.maxLeverage))

  const balance = useReadContract({
    address: token.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [(w.address ?? zeroAddress) as Address],
    query: { enabled: !!w.address },
  })

  let collateral = 0n
  try {
    collateral = parseUnits(collateralIn || '0', token.decimals)
  } catch {}
  // size = net * lev and fee = size * openFee, so size = c * lev / (1 + lev * fee)
  const size = (collateral * BigInt(lev) * 10_000n) / (10_000n + BigInt(lev * m.openFeeBps))
  const fee = (size * BigInt(m.openFeeBps)) / 10_000n
  const net = collateral - fee
  const px = price?.price ?? 0
  const buffer = p.amount(net) - p.amount((size * BigInt(m.maintenanceBps)) / 10_000n)
  const liq = size > 0n ? (side === 'long' ? px - (buffer * px) / p.amount(size) : px + (buffer * px) / p.amount(size)) : 0
  const tooSmall = collateral < p.perps.minCollateral
  const insufficient = balance.data != null && collateral > balance.data

  const submit = () =>
    tx.run(`Opened ${side} ${symbol}`, async () => {
      if (!w.address || !price || !ADDRESSES) return
      await tx.ensureAllowance(token.address, w.address as Address, ADDRESSES.perps, collateral, token.symbol)
      const acceptable =
        side === 'long' ? (price.priceWad * (10_000n + SLIPPAGE_BPS)) / 10_000n : (price.priceWad * (10_000n - SLIPPAGE_BPS)) / 10_000n
      await tx.write(`Open ${side}`, {
        address: ADDRESSES.perps,
        abi: LarryPerpsAbi,
        functionName: 'openPosition',
        args: [BigInt(idx), side === 'long', collateral, size, acceptable],
      })
    })

  return (
    <aside className="card ticket">
      <div className="seg full">
        <button className={cls(side === 'long' && 'active buy')} onClick={() => setSide('long')}>
          Long
        </button>
        <button className={cls(side === 'short' && 'active sell')} onClick={() => setSide('short')}>
          Short
        </button>
      </div>
      <label className="field">
        <span>
          Collateral ({token.symbol})
          {balance.data != null && (
            <button className="link-btn" onClick={() => setCollateralIn(formatUnits(balance.data!, token.decimals))}>
              Balance {num(p.amount(balance.data))}
            </button>
          )}
        </span>
        <input type="number" min="0" value={collateralIn} onChange={(e) => setCollateralIn(e.target.value)} />
      </label>
      <label className="field">
        <span>
          Leverage <b className="mono">{lev}x</b>
        </span>
        <input type="range" min={1} max={m.maxLeverage} value={lev} onChange={(e) => setLev(+e.target.value)} />
      </label>
      <dl className="kv">
        <dt>Position size</dt>
        <dd className="mono">{usd(p.amount(size))}</dd>
        <dt>Open fee</dt>
        <dd className="mono">{usd(p.amount(fee))}</dd>
        <dt>Entry price</dt>
        <dd className="mono">{price ? usd(price.price) : 'Loading'}</dd>
        <dt>Est. liquidation</dt>
        <dd className="mono">{liq > 0 ? usd(liq) : 'None'}</dd>
        <dt>Max slippage</dt>
        <dd className="mono">0.5%</dd>
      </dl>
      <NeedWallet />
      {w.address && w.onRobinhood && (
        <button
          className={cls('btn btn-lg full', side === 'long' ? 'btn-accent' : 'btn-sell')}
          onClick={submit}
          disabled={tx.busy || tooSmall || insufficient || !price || price.stale || p.perps.paused}
        >
          {p.perps.paused
            ? 'Trading paused'
            : tooSmall
              ? `Minimum ${num(p.amount(p.perps.minCollateral))} ${token.symbol}`
              : insufficient
                ? `Not enough ${token.symbol}`
                : `${side === 'long' ? 'Long' : 'Short'} ${symbol}`}
        </button>
      )}
      <TxNotice status={tx.status} />
    </aside>
  )
}

export function PerpPositions() {
  const p = useProtocol()
  const w = useWallet()
  const tx = useTx()
  const perps = ADDRESSES?.perps ?? zeroAddress
  const ids = useReadContract({
    address: perps,
    abi: LarryPerpsAbi,
    functionName: 'positionIdsOf',
    args: [(w.address ?? zeroAddress) as Address],
    query: { enabled: !!w.address, refetchInterval: 10_000 },
  })
  const list = ids.data ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls: any[] = list.flatMap((id) => [
    { address: perps, abi: LarryPerpsAbi, functionName: 'getPosition', args: [id] },
    { address: perps, abi: LarryPerpsAbi, functionName: 'positionState', args: [id] },
    { address: perps, abi: LarryPerpsAbi, functionName: 'liquidationPrice', args: [id] },
  ])
  const details = useReadContracts({ allowFailure: true, contracts: calls, query: { enabled: list.length > 0, refetchInterval: 10_000 } })

  const close = (id: bigint, isLong: boolean, priceWad: bigint) =>
    tx.run('Position closed', async () => {
      const acceptable = isLong ? (priceWad * (10_000n - SLIPPAGE_BPS)) / 10_000n : (priceWad * (10_000n + SLIPPAGE_BPS)) / 10_000n
      await tx.write('Close position', { address: perps, abi: LarryPerpsAbi, functionName: 'closePosition', args: [id, acceptable] })
    })

  return (
    <div className="card positions">
      <h3>Your perp positions</h3>
      {!w.address ? (
        <p className="empty muted">Connect a wallet to see your positions.</p>
      ) : list.length === 0 ? (
        <p className="empty muted">No open positions.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Side</th>
                <th className="r">Size</th>
                <th className="r">Collateral</th>
                <th className="r">Entry</th>
                <th className="r">Mark</th>
                <th className="r hide-sm">Liq. price</th>
                <th className="r">PnL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((id, i) => {
                const pos = details.data?.[3 * i]?.result as
                  | { marketId: number; isLong: boolean; size: bigint; collateral: bigint; entryPrice: bigint }
                  | undefined
                const st = details.data?.[3 * i + 1]?.result as readonly [bigint, bigint, bigint, bigint, boolean] | undefined
                const liq = details.data?.[3 * i + 2]?.result as bigint | undefined
                if (!pos) return null
                const sym = ASSETS[pos.marketId]?.symbol ?? '?'
                const equity = st ? p.amount(st[3]) : 0
                const pnl = equity - p.amount(pos.collateral)
                return (
                  <tr key={String(id)}>
                    <td className="mono">
                      {sym} PERP {st?.[4] && <span className="tag warn-tag">Liquidatable</span>}
                    </td>
                    <td className={pos.isLong ? 'up' : 'down'}>{pos.isLong ? 'Long' : 'Short'}</td>
                    <td className="r mono">{usd(p.amount(pos.size))}</td>
                    <td className="r mono">{usd(p.amount(pos.collateral))}</td>
                    <td className="r mono">{usd(Number(formatUnits(pos.entryPrice, 18)))}</td>
                    <td className="r mono">{st ? usd(Number(formatUnits(st[0], 18))) : 'Stale'}</td>
                    <td className="r mono hide-sm">{liq != null ? usd(Number(formatUnits(liq, 18))) : ''}</td>
                    <td className={cls('r mono', pnl >= 0 ? 'up' : 'down')}>{st ? changeUsd(pnl) : ''}</td>
                    <td className="r">
                      <button className="btn btn-sm btn-ghost" disabled={tx.busy || !st} onClick={() => st && close(id, pos.isLong, st[0])}>
                        Close
                      </button>
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
