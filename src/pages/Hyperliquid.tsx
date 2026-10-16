import { useMemo, useState } from 'react'
import { useWalletClient } from 'wagmi'
import { getAddress, type Address } from 'viem'
import { NeedWallet, TxNotice } from '../components/Status'
import { PriceChart } from '../components/PriceChart'
import { SmartLink } from '../components/SmartLink'
import { HL_APP, HL_BUILDER, HL_BUILDER_FEE_PCT, HL_SLIPPAGE, HL_TESTNET } from '../config/hyperliquid'
import { enableHlTrading, hlClose, hlError, hlMarketOrder, useHlAccount, useHlCandles, useHlMarkets, type HlMarket } from '../lib/hyperliquid'
import type { TxStatus } from '../lib/tx'
import { useWallet } from '../lib/wallet'
import { useQueryClient } from '@tanstack/react-query'
import { cls, compactUsd, num, pct, usd } from '../lib/format'

/** Price with as many decimals as small coins need. */
const px = (v: number) => (v >= 1000 ? usd(v, 2) : v >= 1 ? usd(v, 4) : `$${v.toPrecision(4)}`)

function useRunner() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<TxStatus>({ kind: 'idle' })
  const run = async (done: string, fn: (step: (label: string) => void) => Promise<unknown>) => {
    try {
      await fn((label) => setStatus({ kind: 'pending', label }))
      setStatus({ kind: 'done', label: done })
      await qc.invalidateQueries({ queryKey: ['hl'] })
    } catch (e) {
      setStatus({ kind: 'error', message: hlError(e) })
    }
  }
  return { status, run, busy: status.kind === 'pending' }
}

export function Hyperliquid() {
  const markets = useHlMarkets()
  const [coin, setCoin] = useState('BTC')
  const [q, setQ] = useState('')
  const w = useWallet()
  const user = w.address ? getAddress(w.address) : null
  const acct = useHlAccount(user)
  const list = markets.data ?? []
  const m = list.find((x) => x.coin === coin) ?? list[0]
  const shown = useMemo(() => list.filter((x) => x.coin.toLowerCase().includes(q.trim().toLowerCase())).slice(0, q ? 60 : 30), [list, q])

  return (
    <div className="app-page container hl">
      <div className="page-head">
        <div>
          <p className="eyebrow accent hl-powered">
            <span className="hl-dot" /> Powered by Hyperliquid{HL_TESTNET && ' · testnet'}
          </p>
          <h1>Hyperliquid perps</h1>
          <p className="muted">Every Hyperliquid perpetual, traded from Larry. Orders fill on Hyperliquid's order book and your funds stay in your Hyperliquid account.</p>
        </div>
        <SmartLink to="/docs/hyperliquid" className="btn btn-ghost btn-sm">
          How it works
        </SmartLink>
      </div>

      {markets.isError && (
        <div className="notice err">
          Could not reach Hyperliquid.{' '}
          <button className="link" onClick={() => markets.refetch()}>
            Try again
          </button>
        </div>
      )}
      {markets.isLoading && <div className="loading-bar" />}

      {m && (
        <div className="hl-layout">
          <aside className="card hl-markets">
            <input placeholder={`Search ${list.length} markets`} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="hl-list">
              {shown.map((x) => (
                <button key={x.coin} className={cls('hl-mkt', x.coin === m.coin && 'on')} onClick={() => setCoin(x.coin)}>
                  <b>{x.coin}</b>
                  <span className="mono small">{px(x.mark)}</span>
                  <span className={cls('mono small', x.change >= 0 ? 'up' : 'down')}>
                    {x.change >= 0 ? '+' : ''}
                    {(x.change * 100).toFixed(2)}%
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <div className="hl-main">
            <MarketCard m={m} />
            <Positions user={user} markets={list} acct={acct.data} />
          </div>

          <Ticket m={m} user={user} acct={acct.data} />
        </div>
      )}
      <p className="muted small hl-foot">
        Larry is an independent front end for Hyperliquid and is not affiliated with Hyperliquid. Orders placed here include a {HL_BUILDER_FEE_PCT} Larry builder fee on top of Hyperliquid's own fees.
      </p>
    </div>
  )
}

function MarketCard({ m }: { m: HlMarket }) {
  const candles = useHlCandles(m.coin)
  return (
    <div className="card">
      <div className="market-head">
        <div>
          <div className="mono">
            {m.coin}-PERP <span className="tag">{m.maxLeverage}x</span>
          </div>
          <div className="mono big">{px(m.mark)}</div>
          <div className={cls('mono small', m.change >= 0 ? 'up' : 'down')}>
            {m.change >= 0 ? '+' : ''}
            {(m.change * 100).toFixed(2)}% 24h
          </div>
        </div>
        <div className="market-meta">
          <div>
            <div className="muted small">24h volume</div>
            <div className="mono">{compactUsd(m.volume)}</div>
          </div>
          <div>
            <div className="muted small">Open interest</div>
            <div className="mono">{compactUsd(m.openInterest)}</div>
          </div>
          <div className="hide-sm">
            <div className="muted small">Funding / hour</div>
            <div className={cls('mono', m.funding >= 0 ? 'up' : 'down')}>{pct(m.funding, 4)}</div>
          </div>
          <div className="hide-sm">
            <div className="muted small">Oracle</div>
            <div className="mono">{px(m.oracle)}</div>
          </div>
        </div>
      </div>
      {candles.data && candles.data.length > 1 ? <PriceChart points={candles.data} height={260} unit="hourly candles" /> : <div className="hl-chart-empty muted small">Loading chart</div>}
    </div>
  )
}

type Acct = ReturnType<typeof useHlAccount>['data']

function Ticket({ m, user, acct }: { m: HlMarket; user: Address | null; acct: Acct }) {
  const { data: wallet } = useWalletClient()
  const r = useRunner()
  const [long, setLong] = useState(true)
  const [marginIn, setMarginIn] = useState('50')
  const [levRaw, setLev] = useState(5)
  const lev = Math.min(levRaw, m.maxLeverage)
  const margin = Number(marginIn) || 0
  const notional = margin * lev
  const size = m.mid ? notional / m.mid : 0
  const ready = !!acct?.builderApproved && !!acct?.agentApproved
  const noFunds = !!acct && acct.withdrawable < margin

  return (
    <aside className="card ticket">
      <div className="seg full">
        <button className={cls(long && 'active buy')} onClick={() => setLong(true)}>
          Long
        </button>
        <button className={cls(!long && 'active sell')} onClick={() => setLong(false)}>
          Short
        </button>
      </div>
      <label className="field">
        <span>
          Margin (USDC)
          {acct && (
            <button className="link-btn" onClick={() => setMarginIn(String(Math.floor(acct.withdrawable * 100) / 100))}>
              Available {num(acct.withdrawable)}
            </button>
          )}
        </span>
        <input type="number" min="0" value={marginIn} onChange={(e) => setMarginIn(e.target.value)} />
      </label>
      <label className="field">
        <span>
          Leverage <b className="mono">{lev}x</b>
        </span>
        <input type="range" min={1} max={m.maxLeverage} value={lev} onChange={(e) => setLev(+e.target.value)} />
      </label>
      <dl className="kv">
        <dt>Position size</dt>
        <dd className="mono">
          {usd(notional)} · {num(size, Math.min(6, m.szDecimals))} {m.coin}
        </dd>
        <dt>Price</dt>
        <dd className="mono">{px(m.mid)}</dd>
        <dt>Max slippage</dt>
        <dd className="mono">{pct(HL_SLIPPAGE, 1)}</dd>
        <dt>Margin mode</dt>
        <dd className="mono">Cross</dd>
      </dl>

      <NeedWallet />
      {user && acct && !ready && (
        <div className="hl-setup">
          <b>Enable Hyperliquid trading</b>
          <p className="muted small">
            Two signatures, once. Approve the {HL_BUILDER_FEE_PCT} Larry builder fee, then a trading key kept in this browser. The key can place orders but can never withdraw your funds.
          </p>
          <button
            className="btn btn-accent full"
            disabled={r.busy || !wallet}
            onClick={() => r.run('Hyperliquid trading enabled', (step) => enableHlTrading(wallet!, user, !acct.builderApproved, step))}
          >
            Enable trading
          </button>
        </div>
      )}
      {user && acct && ready && (
        <button
          className={cls('btn btn-lg full', long ? 'btn-accent' : 'btn-sell')}
          disabled={r.busy || margin <= 0 || noFunds || !HL_BUILDER}
          onClick={() =>
            r.run(`${long ? 'Long' : 'Short'} ${m.coin} filled`, async (step) => {
              step('Sending to Hyperliquid')
              await hlMarketOrder(user, m, { long, size, leverage: lev })
            })
          }
        >
          {noFunds ? 'Deposit USDC on Hyperliquid' : `${long ? 'Long' : 'Short'} ${m.coin}`}
        </button>
      )}
      {user && acct && (
        <div className="hl-acct small">
          <span className="muted">Hyperliquid account</span>
          <b className="mono">{usd(acct.accountValue)}</b>
          <a className="link" href={`${HL_APP}/portfolio`} target="_blank" rel="noreferrer">
            Deposit ↗
          </a>
        </div>
      )}
      <TxNotice status={r.status} />
    </aside>
  )
}

function Positions({ user, markets, acct }: { user: Address | null; markets: HlMarket[]; acct: Acct }) {
  const r = useRunner()
  return (
    <div className="card positions">
      <h3>Hyperliquid positions</h3>
      {!user ? (
        <p className="empty muted">Connect a wallet to see your Hyperliquid positions.</p>
      ) : !acct ? (
        <p className="empty muted">Loading</p>
      ) : acct.positions.length === 0 ? (
        <p className="empty muted">No open positions on Hyperliquid.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Market</th>
                <th className="r">Size</th>
                <th className="r">Entry</th>
                <th className="r hide-md">Liq. price</th>
                <th className="r">PnL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {acct.positions.map((p) => {
                const mk = markets.find((x) => x.coin === p.coin)
                return (
                  <tr key={p.coin}>
                    <td className="mono">
                      {p.coin} <span className={p.size > 0 ? 'up' : 'down'}>{p.size > 0 ? 'Long' : 'Short'}</span> <span className="muted">{p.leverage}x</span>
                    </td>
                    <td className="r mono">{usd(p.value)}</td>
                    <td className="r mono">{px(p.entry)}</td>
                    <td className="r mono hide-md">{p.liq ? px(p.liq) : ''}</td>
                    <td className={cls('r mono', p.pnl >= 0 ? 'up' : 'down')} title={`${pct(p.roe, 1)} return on margin`}>
                      {p.pnl >= 0 ? '+' : ''}
                      {usd(p.pnl, 2)}
                    </td>
                    <td className="r">
                      <button
                        className="btn btn-sm btn-ghost"
                        disabled={r.busy || !mk || !acct.agentApproved}
                        onClick={() => mk && r.run(`${p.coin} closed`, () => hlClose(user, mk, p))}
                      >
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
      <TxNotice status={r.status} />
    </div>
  )
}
