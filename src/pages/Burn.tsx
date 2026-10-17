import { BurnTracker } from '../components/BurnTracker'
import { TokenCA } from '../components/TokenCA'

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
      <div className="card token-card burn-ca">
        <p className="eyebrow accent">Official contract address</p>
        <TokenCA />
      </div>
    </div>
  )
}
