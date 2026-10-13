import { useEffect, useRef, useState } from 'react'
import { ROBINHOOD_MAINNET, ROBINHOOD_TESTNET, chainById } from '../config/chains'
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

  const chain = chainById(w.chainId)
  return (
    <div className="wallet" ref={ref}>
      {!w.onRobinhood ? (
        <button className="btn btn-warn" onClick={() => w.switchChain()}>
          Switch to Robinhood Chain
        </button>
      ) : (
        <button className="btn btn-ghost" onClick={() => setMenu((m) => !m)}>
          <span className={chain?.testnet ? 'dot dot-warn' : 'dot'} />
          <span className="hide-sm">{chain?.shortName}</span>
          <span className="mono">{shortAddr(w.address)}</span>
        </button>
      )}
      {menu && (
        <div className="dropdown">
          <div className="dropdown-row muted">Balance</div>
          <div className="dropdown-row mono">{w.balance != null ? `${w.balance.toFixed(4)} ETH` : '—'}</div>
          <hr />
          <button onClick={() => w.switchChain(ROBINHOOD_MAINNET)}>Use Robinhood Chain Mainnet</button>
          <button onClick={() => w.switchChain(ROBINHOOD_TESTNET)}>Use Robinhood Chain Testnet</button>
          {chain && (
            <a href={`${chain.explorerUrl}/address/${w.address}`} target="_blank" rel="noreferrer">
              View on explorer ↗
            </a>
          )}
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
