import { shortAddr } from '../lib/format'
import { useWallet } from '../lib/wallet'

export function WalletButton() {
  const w = useWallet()

  if (!w.address) {
    return (
      <button className="btn btn-accent" onClick={w.connect} disabled={w.connecting}>
        {w.connecting ? 'Connecting…' : 'Connect wallet'}
      </button>
    )
  }

  if (!w.onRobinhood) {
    return (
      <button className="btn btn-warn" onClick={w.switchChain}>
        Switch to Robinhood Chain
      </button>
    )
  }

  return (
    <button className="btn btn-ghost" onClick={w.openAccount}>
      <span className="dot" />
      {w.balance != null && <span className="mono hide-sm">{w.balance.toFixed(4)} ETH</span>}
      <span className="mono">{shortAddr(w.address)}</span>
    </button>
  )
}
