import { shortAddr } from '../lib/format'
import { useWallet } from '../lib/wallet'

export function WalletButton({ onAction }: { onAction?: () => void }) {
  const w = useWallet()
  // Close the mobile menu before the Reown modal opens on top of it.
  const run = (fn: () => void) => () => {
    onAction?.()
    fn()
  }

  if (!w.address) {
    return (
      <button className="btn btn-accent" onClick={run(w.connect)} disabled={w.connecting}>
        {w.connecting ? 'Connecting…' : 'Connect wallet'}
      </button>
    )
  }

  if (!w.onRobinhood) {
    return (
      <button className="btn btn-warn" onClick={run(w.switchChain)}>
        Switch to Robinhood Chain
      </button>
    )
  }

  return (
    <button className="btn btn-ghost" onClick={run(w.openAccount)}>
      <span className="dot" />
      {w.balance != null && <span className="mono hide-sm">{w.balance.toFixed(4)} ETH</span>}
      <span className="mono">{shortAddr(w.address)}</span>
    </button>
  )
}
