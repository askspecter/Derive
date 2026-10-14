import { useState } from 'react'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { useWallet } from '../lib/wallet'

const ROWS: [string, string][] = [
  ['Network name', ROBINHOOD_CHAIN.name],
  ['RPC URL', ROBINHOOD_CHAIN.rpcUrl],
  ['Chain ID', String(ROBINHOOD_CHAIN.id)],
  ['Currency symbol', 'ETH'],
  ['Block explorer', ROBINHOOD_CHAIN.explorerUrl],
]

/** Shown under the header while a connected wallet is on another network. */
export function WrongNetwork() {
  const w = useWallet()
  const [manual, setManual] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  if (!w.address || w.onRobinhood) return null

  const copy = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v)
      setCopied(v)
      setTimeout(() => setCopied(null), 1500)
    } catch {}
  }

  return (
    <div className="wrong-network">
      <div className="container wrong-inner">
        <div>
          <b>Your wallet is on another network</b>
          <p className="muted small">Larry runs on Robinhood Chain. Switch your wallet to continue.</p>
        </div>
        <div className="wrong-actions">
          <button className="btn btn-accent" onClick={w.switchChain} disabled={w.switching}>
            {w.switching ? 'Check your wallet' : 'Switch to Robinhood Chain'}
          </button>
          <button className="btn btn-ghost" onClick={() => setManual(!manual)}>
            {manual ? 'Hide steps' : 'Add it manually'}
          </button>
        </div>
      </div>
      {(manual || w.switchError) && (
        <div className="container wrong-manual">
          {w.switchError && <p className="down small">Your wallet could not switch automatically. Add the network by hand:</p>}
          <p className="muted small">
            In your wallet open Settings, Networks, Add network (or Add custom network) and enter:
          </p>
          <div className="net-rows">
            {ROWS.map(([k, v]) => (
              <button key={k} className="net-row" onClick={() => copy(v)}>
                <span className="muted small">{k}</span>
                <span className="mono">{v}</span>
                <span className="accent small">{copied === v ? 'Copied' : 'Copy'}</span>
              </button>
            ))}
          </div>
          <p className="muted small">Then select Robinhood Chain in your wallet and reload this page.</p>
        </div>
      )}
    </div>
  )
}
