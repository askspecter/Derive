import { BurnTracker } from '../components/BurnTracker'
import { TokenCA } from '../components/TokenCA'
import { BUYBACK_WALLET } from '../config/token'
import { ROBINHOOD_CHAIN } from '../config/chains'

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
      {BUYBACK_WALLET && (
        <div className="card burn-bot">
          <div>
            <p className="eyebrow accent">Buyback bot</p>
            <p className="muted small">
              Every few seconds this wallet buys a small amount of $LARRY on the open market and the swap sends it straight to the dead address. Its whole history is public.
            </p>
          </div>
          <a className="btn btn-ghost btn-sm mono" href={`${ROBINHOOD_CHAIN.explorerUrl}/address/${BUYBACK_WALLET}`} target="_blank" rel="noreferrer">
            {BUYBACK_WALLET.slice(0, 8)}…{BUYBACK_WALLET.slice(-6)} ↗
          </a>
        </div>
      )}
      <div className="card token-card burn-ca">
        <p className="eyebrow accent">Official contract address</p>
        <TokenCA />
      </div>
    </div>
  )
}
