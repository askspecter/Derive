import { useState } from 'react'
import { LARRY_TOKEN } from '../config/token'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { cls } from '../lib/format'

/** The official $LARRY contract address with copy and explorer links. */
export function TokenCA({ compact }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(LARRY_TOKEN.address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }
  return (
    <div className={cls('token-ca', compact && 'compact')}>
      <span className="token-ca-label">CA</span>
      <button className="token-ca-addr mono" onClick={copy} title="Copy contract address">
        {compact ? `${LARRY_TOKEN.address.slice(0, 8)}…${LARRY_TOKEN.address.slice(-6)}` : LARRY_TOKEN.address}
      </button>
      <button className="btn btn-ghost btn-sm" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      {!compact && (
        <a className="btn btn-ghost btn-sm" href={`${ROBINHOOD_CHAIN.explorerUrl}/token/${LARRY_TOKEN.address}`} target="_blank" rel="noreferrer">
          Explorer ↗
        </a>
      )}
    </div>
  )
}
