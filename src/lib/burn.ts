// Live $LARRY burn tracker. Totals come straight from the token contract: the balance of the dead
// and zero addresses (plus any supply removed with burn(), if the launch supply is configured).
// The feed lists every transfer into the dead address, newest first.
import { useQuery } from '@tanstack/react-query'
import { usePublicClient, useReadContracts } from 'wagmi'
import { erc20Abi, formatUnits, getAbiItem, type Address, type Hash, type PublicClient } from 'viem'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { BURN_ADDRESSES, LARRY_INITIAL_SUPPLY, LARRY_TOKEN } from '../config/token'

export interface Burn {
  hash: Hash
  from: Address
  amount: number
  /** unix seconds, when known */
  time: number | null
  block: bigint | null
}

export function useBurnTotals() {
  const token = LARRY_TOKEN.address
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: token, abi: erc20Abi, functionName: 'decimals', chainId: ROBINHOOD_CHAIN.id },
      { address: token, abi: erc20Abi, functionName: 'totalSupply', chainId: ROBINHOOD_CHAIN.id },
      { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [BURN_ADDRESSES[0]], chainId: ROBINHOOD_CHAIN.id },
      { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [BURN_ADDRESSES[1]], chainId: ROBINHOOD_CHAIN.id },
    ],
    query: { refetchInterval: 12_000 },
  })
  const r = q.data
  const ok = !!r && r.every((x) => x.status === 'success')
  if (!ok) return { loading: q.isLoading, error: q.isError || (!!r && !ok), burned: 0, supply: 0, share: 0, decimals: 18 }
  const decimals = Number(r[0].result)
  const n = (v: unknown) => Number(formatUnits(v as bigint, decimals))
  const supply = n(r[1].result)
  const inDead = n(r[2].result) + n(r[3].result)
  const viaBurn = LARRY_INITIAL_SUPPLY > supply ? LARRY_INITIAL_SUPPLY - supply : 0
  const burned = inDead + viaBurn
  const launch = LARRY_INITIAL_SUPPLY || supply
  return { loading: false, error: false, burned, supply, share: launch > 0 ? burned / launch : 0, decimals }
}

interface BlockscoutTransfer {
  transaction_hash?: Hash
  tx_hash?: Hash
  timestamp?: string
  block_number?: number
  from?: { hash: Address }
  total?: { value: string; decimals: string | number | null }
  token?: { address?: Address; address_hash?: Address }
}

/** Burns from the explorer index, which covers the token's whole history in one request. */
async function fromExplorer(): Promise<Burn[]> {
  const out: Burn[] = []
  let params = ''
  for (let page = 0; page < 4; page++) {
    const url = `${ROBINHOOD_CHAIN.explorerUrl}/api/v2/addresses/${BURN_ADDRESSES[0]}/token-transfers?type=ERC-20&filter=to&token=${LARRY_TOKEN.address}${params}`
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`explorer ${res.status}`)
    const j = (await res.json()) as { items: BlockscoutTransfer[]; next_page_params: Record<string, string | number> | null }
    for (const t of j.items) {
      const tok = (t.token?.address ?? t.token?.address_hash ?? '').toLowerCase()
      if (tok && tok !== LARRY_TOKEN.address.toLowerCase()) continue
      const dec = Number(t.total?.decimals ?? 18)
      out.push({
        hash: (t.transaction_hash ?? t.tx_hash)!,
        from: t.from!.hash,
        amount: Number(formatUnits(BigInt(t.total?.value ?? '0'), dec)),
        time: t.timestamp ? Math.floor(Date.parse(t.timestamp) / 1000) : null,
        block: t.block_number != null ? BigInt(t.block_number) : null,
      })
    }
    if (!j.next_page_params || out.length >= 200) break
    params = '&' + new URLSearchParams(Object.entries(j.next_page_params).map(([k, v]) => [k, String(v)])).toString()
  }
  return out
}

const transferEvent = getAbiItem({ abi: erc20Abi, name: 'Transfer' })

/** Fallback when the explorer is down: recent burns straight from the chain. */
async function fromChain(client: PublicClient, decimals: number): Promise<Burn[]> {
  const latest = await client.getBlockNumber({ cacheTime: 0 })
  const span = 2_000_000n
  const fetchRange = async (from: bigint, to: bigint): Promise<Awaited<ReturnType<typeof get>>> => {
    try {
      return await get(from, to)
    } catch (e) {
      if (to - from < 5_000n) throw e
      const mid = from + (to - from) / 2n
      return [...(await fetchRange(from, mid)), ...(await fetchRange(mid + 1n, to))]
    }
  }
  const get = (fromBlock: bigint, toBlock: bigint) =>
    client.getLogs({ address: LARRY_TOKEN.address, event: transferEvent, args: { to: [...BURN_ADDRESSES] }, fromBlock, toBlock })
  const logs = await fetchRange(latest > span ? latest - span : 0n, latest)
  return logs
    .map((l) => ({ hash: l.transactionHash!, from: l.args.from!, amount: Number(formatUnits(l.args.value!, decimals)), time: null, block: l.blockNumber }))
    .reverse()
}

export function useBurnFeed(decimals: number) {
  const client = usePublicClient({ chainId: ROBINHOOD_CHAIN.id })
  return useQuery({
    queryKey: ['burns', LARRY_TOKEN.address],
    queryFn: async () => {
      try {
        return { source: 'explorer' as const, burns: await fromExplorer() }
      } catch {
        return { source: 'chain' as const, burns: await fromChain(client as PublicClient, decimals) }
      }
    },
    enabled: !!client,
    refetchInterval: 15_000,
  })
}
