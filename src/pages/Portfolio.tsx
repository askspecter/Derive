import { Link } from 'react-router-dom'
import { useReadContracts } from 'wagmi'
import { erc20Abi, zeroAddress, type Address } from 'viem'
import { ADDRESSES } from '../config/protocol'
import { NeedWallet, NotLive } from '../components/Status'
import { LarryPoolAbi } from '../lib/abis'
import { useProtocol } from '../lib/protocol'
import { useWallet } from '../lib/wallet'
import { shortAddr, usd } from '../lib/format'
import { PerpPositions } from './Perps'
import { OptionPositions } from './Options'

export function Portfolio() {
  const p = useProtocol()
  const w = useWallet()
  const me = (w.address ?? zeroAddress) as Address
  const pool = ADDRESSES?.pool ?? zeroAddress
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: p.token?.address ?? zeroAddress, abi: erc20Abi, functionName: 'balanceOf', args: [me] },
      { address: pool, abi: LarryPoolAbi, functionName: 'balanceOf', args: [me] },
    ],
    query: { enabled: !!w.address && !!p.token, refetchInterval: 10_000 },
  })
  const shares = (q.data?.[1]?.result as bigint | undefined) ?? 0n
  const lpValue = useReadContracts({
    contracts: [{ address: pool, abi: LarryPoolAbi, functionName: 'convertToAssets', args: [shares] }],
    query: { enabled: shares > 0n },
  })

  if (!p.live) return <div className="app-page container"><NotLive /></div>
  const sym = p.token?.symbol ?? 'USDG'

  return (
    <div className="app-page container">
      <div className="page-head">
        <div>
          <h1>Portfolio</h1>
          <p className="muted">{w.address ? <>Wallet <span className="mono">{shortAddr(w.address)}</span></> : 'Connect a wallet to see your positions.'}</p>
        </div>
      </div>
      {!w.address ? (
        <div className="card narrow">
          <NeedWallet />
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="card stat">
              <div className="muted small">Wallet {sym}</div>
              <div className="stat-value">{usd(p.amount((q.data?.[0]?.result as bigint | undefined) ?? 0n))}</div>
            </div>
            <div className="card stat">
              <div className="muted small">Vault position</div>
              <div className="stat-value">{usd(p.amount((lpValue.data?.[0]?.result as bigint | undefined) ?? 0n))}</div>
            </div>
            <div className="card stat">
              <div className="muted small">Wallet ETH</div>
              <div className="stat-value">{w.balance != null ? w.balance.toFixed(4) : '0'}</div>
            </div>
            <Link to="/vaults" className="card stat stat-link">
              <div className="muted small">Earn</div>
              <div className="stat-value">Vault →</div>
            </Link>
          </div>
          <PerpPositions />
          <OptionPositions />
        </>
      )}
    </div>
  )
}
