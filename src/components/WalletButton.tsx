import { useEffect, useRef, useState } from 'react'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { shortAddr } from '../lib/format'
import { useWallet } from '../lib/wallet'

export function WalletButton() {
  const w = useWallet()
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  if (!w.address) {
    return (
      <div className="wallet" ref={ref}>
        <button className="btn btn-accent" onClick={w.connect} disabled={w.connecting}>
          {w.connecting ? 'Connecting…' : 'Connect wallet'}
        </button>
        {w.error && <div className="wallet-error">{w.error}</div>}
      </div>
    )
  }

  return (
    <div className="wallet" ref={ref}>
      {!w.onRobinhood ? (
        <button className="btn btn-warn" onClick={() => w.switchChain()}>
          Switch to Robinhood Chain
        </button>
      ) : (
        <button className="btn btn-ghost" onClick={() => setMenu((m) => !m)}>
          <span className="dot" />
          <span className="hide-sm">Robinhood Chain</span>
          <span className="mono">{shortAddr(w.address)}</span>
        </button>
      )}
      {menu && (
        <div className="dropdown">
          <div className="dropdown-row muted">Balance</div>
          <div className="dropdown-row mono">{w.balance != null ? `${w.balance.toFixed(4)} ETH` : '—'}</div>
          <hr />
          <a href={`${ROBINHOOD_CHAIN.explorerUrl}/address/${w.address}`} target="_blank" rel="noreferrer">
            View on explorer ↗
          </a>
          <hr />
          <button
            onClick={() => {
              w.disconnect()
              setMenu(false)
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
