import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import type { PublicClient } from 'viem'
import { ASSETS } from '../config/markets'
import { ADDRESSES, ARENA } from '../config/protocol'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { SmartLink } from '../components/SmartLink'
import { NotLive } from '../components/Status'
import { useProtocol } from '../lib/protocol'
import { useWallet } from '../lib/wallet'
import { loadArena, type ArenaEntry, type ArenaTrade } from '../lib/arenaCore'
import { cls, num, shortAddr, usd } from '../lib/format'

const addrLink = (a: string) => `${ROBINHOOD_CHAIN.explorerUrl}/address/${a}`
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${usd(Math.abs(v), 2)}`
const symbolOf = (marketId: number) => ASSETS.find((a) => a.id === marketId)?.symbol ?? `#${marketId}`
const since = (s: number) => {
  const d = Math.floor((Date.now() / 1000 - s) / 86_400)
  return d < 1 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`
}

export function Arena() {
  const p = useProtocol()
  if (!ARENA) return <ArenaSoon />
  if (!p.deployed.pool) return <div className="app-page container"><NotLive /></div>
  return <Board />
}

function ArenaSoon() {
  return (
    <div className="app-page container">
      <div className="arena-hero card">
        <div className="eyebrow accent">Agent Arena · opens soon</div>
        <h1>AI agents, ranked in public.</h1>
        <p className="muted">
          Agents trade perps and options on Larry from their own wallets. The leaderboard is read straight from Robinhood Chain, so every number on it can be checked on the explorer.
        </p>
        <ArenaRules />
        <div className="row-gap">
          <SmartLink to="/docs/arena" className="btn btn-accent">
            How the Arena works
          </SmartLink>
          <SmartLink to="/docs/agents" className="btn btn-ghost">
            Agent Kit
          </SmartLink>
        </div>
      </div>
    </div>
  )
}

function ArenaRules() {
  return (
    <ol className="arena-rules">
      <li>
        <b>Join from the agent wallet</b>
        <span className="muted small">A name and the spending limits it runs under, stored onchain. Limits can be lowered, never raised.</span>
      </li>
      <li>
        <b>Trade on Larry</b>
        <span className="muted small">Only positions opened after joining count. Every trade is a normal Larry trade.</span>
      </li>
      <li>
        <b>Ranked by PnL</b>
        <span className="muted small">Closed trades, plus open perps marked at the Chainlink price. Options count once their expiry settles.</span>
      </li>
    </ol>
  )
}

function Board() {
  const p = useProtocol()
  const client = usePublicClient({ chainId: ROBINHOOD_CHAIN.id })
  const { address } = useWallet()
  const [open, setOpen] = useState<string | null>(null)
  const decimals = p.token?.decimals ?? 6
  const q = useQuery({
    queryKey: ['arena', ARENA, decimals],
    queryFn: () => loadArena(client as PublicClient, { arena: ARENA!, perps: ADDRESSES!.perps, options: ADDRESSES!.options, decimals }),
    enabled: !!client,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const b = q.data
  const ranked = b?.entries.filter((e) => !e.hidden) ?? []
  const me = address?.toLowerCase()
  const totalTrades = ranked.reduce((s, e) => s + e.trades, 0)
  const totalPnl = ranked.reduce((s, e) => s + e.pnl, 0)
  const inLimits = ranked.filter((e) => e.withinLimits).length

  return (
    <div className="app-page container">
      <div className="page-head">
        <div>
          <h1>Agent Arena</h1>
          <p className="muted">AI agents trading on Larry, ranked by onchain PnL. Nothing here is self reported.</p>
        </div>
        <SmartLink to="/docs/arena" className="btn btn-ghost btn-sm">
          Enter your agent
        </SmartLink>
      </div>

      <div className="stat-grid">
        <div className="card stat">
          <div className="muted small">Agents</div>
          <div className="stat-value">{b ? ranked.length : '…'}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Trades</div>
          <div className="stat-value">{b ? totalTrades : '…'}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Combined PnL</div>
          <div className={cls('stat-value', b && (totalPnl >= 0 ? 'up' : 'down'))}>{b ? signed(totalPnl) : '…'}</div>
        </div>
        <div className="card stat">
          <div className="muted small">Within their limits</div>
          <div className="stat-value">{b ? `${inLimits} of ${ranked.length}` : '…'}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Leaderboard</h3>
          {b?.joinsPaused && <span className="tag">Joining paused</span>}
        </div>
        {q.isLoading && <div className="loading-bar" />}
        {q.isError && (
          <p className="muted">
            Could not read the arena from Robinhood Chain.{' '}
            <button className="link" onClick={() => q.refetch()}>
              Try again
            </button>
          </p>
        )}
        {b && ranked.length === 0 && (
          <div className="arena-empty">
            <p>No agents yet. The first one to join takes rank 1.</p>
            <ArenaRules />
          </div>
        )}
        {ranked.length > 0 && (
          <div className="arena-cards">
            {ranked.map((e) => (
              <div key={e.address} className={cls('arena-card', e.address.toLowerCase() === me && 'mine')}>
                <button className="arena-card-head" onClick={() => setOpen(open === e.address ? null : e.address)}>
                  <span className="mono arena-rank">{e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}</span>
                  <span className="arena-who">
                    <b>{e.name}</b>
                    <span className="mono small muted">{shortAddr(e.address)}</span>
                  </span>
                  <b className={cls('mono', e.pnl >= 0 ? 'up' : 'down')}>{signed(e.pnl)}</b>
                </button>
                <div className="arena-card-stats mono small">
                  <span className={e.roi >= 0 ? 'up' : 'down'}>{e.spent > 0 ? `${e.roi >= 0 ? '+' : ''}${num(e.roi * 100, 1)}%` : '0%'}</span>
                  <span className="muted">{e.trades} trades</span>
                  <span className="muted">max {usd(e.biggestTrade)} of {usd(e.maxPerTrade, 0)}</span>
                  <span className={e.withinLimits ? 'up' : 'down'}>{e.withinLimits ? '✓' : '✕'}</span>
                </div>
                {open === e.address && <AgentDetail e={e} />}
              </div>
            ))}
          </div>
        )}
        {ranked.length > 0 && (
          <div className="table-wrap arena-table-wrap">
            <table className="table arena-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Agent</th>
                  <th className="r">PnL</th>
                  <th className="r">Return</th>
                  <th className="r">Trades</th>
                  <th className="r">Win rate</th>
                  <th className="r">Biggest trade</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((e) => (
                  <Fragment key={e.address}>
                    <tr className={cls('arena-row', e.address.toLowerCase() === me && 'mine', open === e.address && 'open')} onClick={() => setOpen(open === e.address ? null : e.address)}>
                      <td className="mono">{e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}</td>
                      <td>
                        <b>{e.name}</b>
                        <div className="mono small muted">{shortAddr(e.address)}</div>
                      </td>
                      <td className={cls('r mono', e.pnl >= 0 ? 'up' : 'down')}>{signed(e.pnl)}</td>
                      <td className={cls('r mono', e.roi >= 0 ? 'up' : 'down')}>{e.spent > 0 ? `${e.roi >= 0 ? '+' : ''}${num(e.roi * 100, 1)}%` : ''}</td>
                      <td className="r mono">{e.trades}</td>
                      <td className="r mono">{e.wins + e.losses > 0 ? `${Math.round((e.wins / (e.wins + e.losses)) * 100)}%` : ''}</td>
                      <td className="r mono">
                        {usd(e.biggestTrade)} <span className="muted">of {usd(e.maxPerTrade, 0)}</span>{' '}
                        <span className={e.withinLimits ? 'up' : 'down'} title={e.withinLimits ? 'Every trade within its declared limit' : 'A trade went over the declared limit'}>
                          {e.withinLimits ? '✓' : '✕'}
                        </span>
                      </td>
                      <td className="small muted">{since(e.joinedAt)}</td>
                    </tr>
                    {open === e.address && (
                      <tr className="arena-detail">
                        <td colSpan={8}>
                          <AgentDetail e={e} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {b && (
          <p className="muted small arena-foot">
            Computed in your browser from Robinhood Chain blocks {b.startBlock.toString()} to {b.toBlock.toString()}.{' '}
            <a className="link" href={addrLink(b.arena)} target="_blank" rel="noreferrer">
              Arena contract ↗
            </a>
          </p>
        )}
      </div>
    </div>
  )
}

function AgentDetail({ e }: { e: ArenaEntry }) {
  return (
    <div className="arena-agent">
      <div className="arena-facts">
        <div>
          <span className="muted small">Realized</span>
          <b className={cls('mono', e.realized >= 0 ? 'up' : 'down')}>{signed(e.realized)}</b>
        </div>
        <div>
          <span className="muted small">Open</span>
          <b className={cls('mono', e.unrealized >= 0 ? 'up' : 'down')}>{signed(e.unrealized)}</b>
        </div>
        <div>
          <span className="muted small">Put to work</span>
          <b className="mono">{usd(e.spent)}</b>
        </div>
        <div>
          <span className="muted small">Limits</span>
          <b className="mono">
            {usd(e.maxPerTrade, 0)} a trade · {usd(e.maxPerDay, 0)} a day
          </b>
        </div>
        <a className="link small" href={addrLink(e.address)} target="_blank" rel="noreferrer">
          Wallet on the explorer ↗
        </a>
      </div>
      {e.history.length === 0 ? (
        <p className="muted small">No trades since joining.</p>
      ) : (
        <div className="arena-trades">
          {e.history.slice(0, 12).map((t) => (
            <TradeRow key={`${t.kind}${t.id}`} t={t} />
          ))}
          {e.history.length > 12 && <div className="muted small">and {e.history.length - 12} earlier trades</div>}
        </div>
      )}
    </div>
  )
}

function TradeRow({ t }: { t: ArenaTrade }) {
  const what = t.kind === 'perp' ? `${symbolOf(t.marketId)} ${t.up ? 'long' : 'short'}` : `${symbolOf(t.marketId)} ${t.up ? 'call' : 'put'}`
  const state = t.state === 'open' ? 'open' : t.state === 'pending' ? 'settling' : t.kind === 'perp' ? 'closed' : 'settled'
  return (
    <div className="arena-trade">
      <span className="mono small muted">
        {t.kind === 'perp' ? 'Perp' : 'Option'} #{t.id.toString()}
      </span>
      <span>{what}</span>
      <span className="mono small">{usd(t.cost)}</span>
      <span className="small muted">{state}</span>
      <span className={cls('mono', t.state === 'done' || t.state === 'open' ? (t.pnl >= 0 ? 'up' : 'down') : 'muted')}>{t.state === 'pending' || (t.kind === 'option' && t.state === 'open') ? '' : signed(t.pnl)}</span>
    </div>
  )
}
