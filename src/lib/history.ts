import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import { aggregatorAbi } from './abis'

export interface Point {
  t: number
  p: number
}

/** Reads the last `count` Chainlink rounds of a feed, oldest first. */
export function useFeedHistory(feed: Address | undefined, latestRound: bigint | undefined, decimals = 8, count = 60) {
  const ids = useMemo(() => {
    if (!latestRound) return []
    const out: bigint[] = []
    for (let i = count - 1; i >= 0; i--) {
      const id = latestRound - BigInt(i)
      if (id > 0n) out.push(id)
    }
    return out
  }, [latestRound, count])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls: any[] = [
    { address: feed ?? zeroAddress, abi: aggregatorAbi, functionName: 'decimals' },
    ...ids.map((id) => ({ address: feed ?? zeroAddress, abi: aggregatorAbi, functionName: 'getRoundData', args: [id] })),
  ]
  const q = useReadContracts({
    allowFailure: true,
    contracts: calls,
    query: { enabled: !!feed && ids.length > 0, staleTime: 30_000 },
  })

  return useMemo<Point[]>(() => {
    const data = q.data ?? []
    const dec = data[0]?.status === 'success' ? Number(data[0].result) : decimals
    const pts: Point[] = []
    for (const x of data.slice(1)) {
      if (x.status !== 'success') continue
      const [, answer, , updatedAt] = x.result as readonly [bigint, bigint, bigint, bigint, bigint]
      if (answer > 0n && updatedAt > 0n) pts.push({ t: Number(updatedAt), p: Number(answer) / 10 ** dec })
    }
    return pts
  }, [q.data, decimals])
}
