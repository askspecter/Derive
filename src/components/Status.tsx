import { SmartLink as Link } from './SmartLink'
import type { TxStatus } from '../lib/tx'
import { useProtocol } from '../lib/protocol'
import { useWallet } from '../lib/wallet'

export function TxNotice({ status }: { status: TxStatus }) {
  if (status.kind === 'idle') return null
  if (status.kind === 'pending') return <div className="notice pending">{status.label}</div>
  if (status.kind === 'done') return <div className="notice ok">{status.label}</div>
  return <div className="notice err">{status.message}</div>
}

/** Shown on app pages until the contracts are deployed and wired up. */
export function NotLive() {
  const p = useProtocol()
  const { address } = useWallet()
  const isAdmin = !!address && !!p.admin && address.toLowerCase() === p.admin.toLowerCase()
  return (
    <div className="card not-live">
      <p className="eyebrow accent">Launching soon</p>
      <h2>Larry is not live yet</h2>
      <p className="muted">
        {!p.configured
          ? 'The admin wallet has not been configured for this site.'
          : 'The protocol contracts have not been deployed to Robinhood Chain yet.'}
      </p>
      {isAdmin || !p.configured ? (
        <Link to="/admin" className="btn btn-accent">
          Open admin setup
        </Link>
      ) : (
        <Link to="/docs" className="btn btn-ghost">
          Read the docs
        </Link>
      )}
    </div>
  )
}

/** Connect button for places where an action needs a wallet. */
export function NeedWallet({ label = 'Connect wallet' }: { label?: string }) {
  const w = useWallet()
  if (!w.address)
    return (
      <button className="btn btn-accent btn-lg full" onClick={w.connect}>
        {label}
      </button>
    )
  if (!w.onRobinhood)
    return (
      <button className="btn btn-warn btn-lg full" onClick={w.switchChain}>
        Switch to Robinhood Chain
      </button>
    )
  return null
}
