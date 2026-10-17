import { useReadContracts } from 'wagmi'
import { formatEther } from 'viem'
import { BurnTracker } from '../components/BurnTracker'
import { TokenCA } from '../components/TokenCA'
import { BUYBACK_CONTRACT } from '../config/token'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { LarryBuybackAbi } from '../lib/abis'

export function BurnPage() {
  return (
    <div className="app-page container">
      <div className="page-head">
        <div>
          <p className="eyebrow accent">Buy back and burn</p>
          <h1>$LARRY burn tracker</h1>
          <p className="muted">Live from Robinhood Chain. Every $LARRY sent to the dead address shows up here the moment it lands.</p>
        </div>
      </div>
      <BurnTracker />
      {BUYBACK_CONTRACT && <BuybackCard />}
      <div className="card token-card burn-ca">
        <p className="eyebrow accent">Official contract address</p>
        <TokenCA />
      </div>
    </div>
  )
}

/** Live stats of the LarryBuyback contract, read from the chain. */
function BuybackCard() {
  const c = { address: BUYBACK_CONTRACT!, abi: LarryBuybackAbi, chainId: ROBINHOOD_CHAIN.id } as const
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...c, functionName: 'buys' },
      { ...c, functionName: 'totalSpent' },
      { ...c, functionName: 'maxPerDay' },
      { ...c, functionName: 'paused' },
    ],
    query: { refetchInterval: 8_000 },
  })
  const [buys, spent, perDay, paused] = (q.data ?? []).map((r) => r.result) as [bigint?, bigint?, bigint?, boolean?]
  const eth = (v?: bigint) => (v === undefined ? '…' : `${Number(formatEther(v)).toFixed(4)} ETH`)
  return (
    <div className="card burn-bot">
      <div>
        <p className="eyebrow accent">Buyback contract {paused ? '· paused' : ''}</p>
        <p className="muted small">
          This contract holds ETH and, every few seconds, buys a little $LARRY on the open market and sends all of it to the dead address in the same transaction. Its limits are enforced onchain.
        </p>
        <div className="burn-facts">
          <div>
            <span className="muted small">Buybacks</span>
            <b className="mono">{buys === undefined ? '…' : buys.toLocaleString('en-US')}</b>
          </div>
          <div>
            <span className="muted small">ETH spent</span>
            <b className="mono">{eth(spent)}</b>
          </div>
          <div>
            <span className="muted small">Daily limit</span>
            <b className="mono">{eth(perDay)}</b>
          </div>
        </div>
      </div>
      <a className="btn btn-ghost btn-sm mono" href={`${ROBINHOOD_CHAIN.explorerUrl}/address/${BUYBACK_CONTRACT}`} target="_blank" rel="noreferrer">
        {BUYBACK_CONTRACT!.slice(0, 8)}…{BUYBACK_CONTRACT!.slice(-6)} ↗
      </a>
    </div>
  )
}
