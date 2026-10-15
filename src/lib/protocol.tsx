import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useBytecode, useReadContracts } from 'wagmi'
import { erc20Abi, formatUnits, zeroAddress, type Address } from 'viem'
import { ADDRESSES, ADMIN } from '../config/protocol'
import { ASSETS } from '../config/markets'
import { LarryOptionsAbi, LarryPerpsAbi, LarryPoolAbi, aggregatorAbi } from './abis'

// Reads every piece of protocol state the UI needs, refreshing on an interval.

const REFRESH = 10_000

export interface PerpMarket {
  feed: Address
  heartbeat: number
  maxLeverage: number
  openFeeBps: number
  closeFeeBps: number
  borrowBpsPerDay: number
  maintenanceBps: number
  liquidationFeeBps: number
  maxProfitMultiple: number
  maxOpenInterest: bigint
  enabled: boolean
}

export interface OptionMarket {
  feed: Address
  heartbeat: number
  vol: bigint
  spreadBps: number
  minPremiumBps: number
  maxExpiry: number
  maxOpenNotional: bigint
  enabled: boolean
}

export interface Price {
  price: number
  priceWad: bigint
  updatedAt: number
  roundId: bigint
  stale: boolean
  feed: Address
}

export interface ProtocolState {
  configured: boolean
  loading: boolean
  deployed: { pool: boolean; perps: boolean; options: boolean }
  live: boolean
  admin: Address | null
  token: { address: Address; symbol: string; decimals: number } | null
  pool: {
    owner: Address | null
    totalAssets: bigint
    totalReserved: bigint
    freeLiquidity: bigint
    totalSupply: bigint
    depositCap: bigint
    lockPeriod: number
    depositsPaused: boolean
    treasury: Address | null
    perpsEnabled: boolean
    optionsEnabled: boolean
  }
  perps: {
    owner: Address | null
    paused: boolean
    protocolShareBps: number
    minCollateral: bigint
    markets: (PerpMarket | null)[]
    oiLong: bigint[]
    oiShort: bigint[]
  }
  options: {
    owner: Address | null
    paused: boolean
    protocolFeeBps: number
    markets: (OptionMarket | null)[]
    openNotional: bigint[]
    /** False on the first options contract, which only lists Friday expiries. */
    supportsDaily: boolean
    /** Per asset: daily (0DTE) expiries listed. */
    daily: boolean[]
    /** Extra spread on options with under a day left, bps. */
    shortDatedSpreadBps: number
  }
  /** Latest oracle price per asset symbol, from whichever market lists a feed. */
  prices: Record<string, Price | undefined>
  /** Heartbeat used to call a price stale, per symbol. */
  refetch(): void
  /** Formats a collateral token amount as a number. */
  amount(v: bigint): number
}

const Ctx = createContext<ProtocolState | null>(null)
const r = <T,>(x: { result?: unknown; status: string } | undefined): T | undefined =>
  x && x.status === 'success' ? (x.result as T) : undefined

export function ProtocolProvider({ children }: { children: ReactNode }) {
  const A = ADDRESSES
  const poolCode = useBytecode({ address: A?.pool, query: { enabled: !!A, refetchInterval: REFRESH } })
  const perpsCode = useBytecode({ address: A?.perps, query: { enabled: !!A, refetchInterval: REFRESH } })
  const optionsCode = useBytecode({ address: A?.options, query: { enabled: !!A, refetchInterval: REFRESH } })
  const deployed = {
    pool: !!poolCode.data && poolCode.data !== '0x',
    perps: !!perpsCode.data && perpsCode.data !== '0x',
    options: !!optionsCode.data && optionsCode.data !== '0x',
  }

  const n = ASSETS.length
  const pool = A?.pool ?? zeroAddress
  const perps = A?.perps ?? zeroAddress
  const options = A?.options ?? zeroAddress

  // Mixed contracts in one multicall: typed loosely here, results are cast by index below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const coreCalls: any[] = [
      { address: pool, abi: LarryPoolAbi, functionName: 'asset' },
      { address: pool, abi: LarryPoolAbi, functionName: 'owner' },
      { address: pool, abi: LarryPoolAbi, functionName: 'totalAssets' },
      { address: pool, abi: LarryPoolAbi, functionName: 'totalReserved' },
      { address: pool, abi: LarryPoolAbi, functionName: 'freeLiquidity' },
      { address: pool, abi: LarryPoolAbi, functionName: 'totalSupply' },
      { address: pool, abi: LarryPoolAbi, functionName: 'depositCap' },
      { address: pool, abi: LarryPoolAbi, functionName: 'lockPeriod' },
      { address: pool, abi: LarryPoolAbi, functionName: 'depositsPaused' },
      { address: pool, abi: LarryPoolAbi, functionName: 'treasury' },
      { address: pool, abi: LarryPoolAbi, functionName: 'isProduct', args: [perps] },
      { address: pool, abi: LarryPoolAbi, functionName: 'isProduct', args: [options] },
      { address: perps, abi: LarryPerpsAbi, functionName: 'owner' },
      { address: perps, abi: LarryPerpsAbi, functionName: 'paused' },
      { address: perps, abi: LarryPerpsAbi, functionName: 'protocolShareBps' },
      { address: perps, abi: LarryPerpsAbi, functionName: 'minCollateral' },
      { address: options, abi: LarryOptionsAbi, functionName: 'owner' },
      { address: options, abi: LarryOptionsAbi, functionName: 'paused' },
      { address: options, abi: LarryOptionsAbi, functionName: 'protocolFeeBps' },
      ...ASSETS.map((_, i) => ({ address: perps, abi: LarryPerpsAbi, functionName: 'markets', args: [BigInt(ASSETS[i].id)] }) as const),
      ...ASSETS.map((_, i) => ({ address: perps, abi: LarryPerpsAbi, functionName: 'openInterestLong', args: [BigInt(ASSETS[i].id)] }) as const),
      ...ASSETS.map((_, i) => ({ address: perps, abi: LarryPerpsAbi, functionName: 'openInterestShort', args: [BigInt(ASSETS[i].id)] }) as const),
      ...ASSETS.map((_, i) => ({ address: options, abi: LarryOptionsAbi, functionName: 'markets', args: [BigInt(ASSETS[i].id)] }) as const),
      ...ASSETS.map((_, i) => ({ address: options, abi: LarryOptionsAbi, functionName: 'openNotional', args: [BigInt(ASSETS[i].id)] }) as const),
      // Daily expiries only exist from the second options contract on; these fail on the first.
      { address: options, abi: LarryOptionsAbi, functionName: 'shortDatedSpreadBps' },
      ...ASSETS.map((_, i) => ({ address: options, abi: LarryOptionsAbi, functionName: 'dailyExpiries', args: [BigInt(ASSETS[i].id)] }) as const),
  ]
  const core = useReadContracts({
    allowFailure: true,
    contracts: coreCalls,
    query: { enabled: !!A && deployed.pool, refetchInterval: REFRESH },
  })
  const d = core.data ?? []
  const asset = r<Address>(d[0])

  const tokenInfo = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: asset ?? zeroAddress, abi: erc20Abi, functionName: 'symbol' },
      { address: asset ?? zeroAddress, abi: erc20Abi, functionName: 'decimals' },
    ],
    query: { enabled: !!asset, staleTime: Infinity },
  })

  const perpMarkets: (PerpMarket | null)[] = ASSETS.map((_, i) => {
    const m = r<readonly [Address, number, number, number, number, number, number, number, number, bigint, boolean]>(d[19 + i])
    if (!m || m[0] === zeroAddress) return null
    return {
      feed: m[0],
      heartbeat: Number(m[1]),
      maxLeverage: Number(m[2]),
      openFeeBps: Number(m[3]),
      closeFeeBps: Number(m[4]),
      borrowBpsPerDay: Number(m[5]),
      maintenanceBps: Number(m[6]),
      liquidationFeeBps: Number(m[7]),
      maxProfitMultiple: Number(m[8]),
      maxOpenInterest: m[9],
      enabled: m[10],
    }
  })
  const optionMarkets: (OptionMarket | null)[] = ASSETS.map((_, i) => {
    const m = r<readonly [Address, number, bigint, number, number, number, bigint, boolean]>(d[19 + 3 * n + i])
    if (!m || m[0] === zeroAddress) return null
    return {
      feed: m[0],
      heartbeat: Number(m[1]),
      vol: m[2],
      spreadBps: Number(m[3]),
      minPremiumBps: Number(m[4]),
      maxExpiry: Number(m[5]),
      maxOpenNotional: m[6],
      enabled: m[7],
    }
  })

  // One feed per asset: prefer the perps listing, fall back to options.
  const feeds = ASSETS.map((_, i) => perpMarkets[i]?.feed ?? optionMarkets[i]?.feed ?? null)
  const heartbeats = ASSETS.map((_, i) => perpMarkets[i]?.heartbeat ?? optionMarkets[i]?.heartbeat ?? 3600)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feedCalls: any[] = feeds.flatMap((f) => [
    { address: f ?? zeroAddress, abi: aggregatorAbi, functionName: 'latestRoundData' },
    { address: f ?? zeroAddress, abi: aggregatorAbi, functionName: 'decimals' },
  ])
  const feedReads = useReadContracts({
    allowFailure: true,
    contracts: feedCalls,
    query: { enabled: feeds.some(Boolean), refetchInterval: REFRESH },
  })

  const prices = useMemo(() => {
    const out: Record<string, Price | undefined> = {}
    const fd = feedReads.data ?? []
    const nowS = Date.now() / 1000
    ASSETS.forEach((a, i) => {
      const feed = feeds[i]
      const round = r<readonly [bigint, bigint, bigint, bigint, bigint]>(fd[2 * i])
      const dec = r<number>(fd[2 * i + 1])
      if (!feed || !round || dec == null || round[1] <= 0n) return
      const priceWad = round[1] * 10n ** BigInt(18 - dec)
      const updatedAt = Number(round[3])
      out[a.symbol] = {
        price: Number(formatUnits(round[1], dec)),
        priceWad,
        updatedAt,
        roundId: round[0],
        stale: nowS - updatedAt > heartbeats[i],
        feed,
      }
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedReads.data, feeds.join(), heartbeats.join()])

  const decimals = r<number>(tokenInfo.data?.[1]) ?? 6
  const value: ProtocolState = {
    configured: !!A,
    loading: poolCode.isLoading || core.isLoading,
    deployed,
    live: deployed.pool && deployed.perps && deployed.options && !!r(d[10]) && !!r(d[11]),
    admin: ADMIN,
    token: asset ? { address: asset, symbol: r<string>(tokenInfo.data?.[0]) ?? 'USDG', decimals } : null,
    pool: {
      owner: r<Address>(d[1]) ?? null,
      totalAssets: r<bigint>(d[2]) ?? 0n,
      totalReserved: r<bigint>(d[3]) ?? 0n,
      freeLiquidity: r<bigint>(d[4]) ?? 0n,
      totalSupply: r<bigint>(d[5]) ?? 0n,
      depositCap: r<bigint>(d[6]) ?? 0n,
      lockPeriod: Number(r<bigint>(d[7]) ?? 0n),
      depositsPaused: r<boolean>(d[8]) ?? false,
      treasury: r<Address>(d[9]) ?? null,
      perpsEnabled: r<boolean>(d[10]) ?? false,
      optionsEnabled: r<boolean>(d[11]) ?? false,
    },
    perps: {
      owner: r<Address>(d[12]) ?? null,
      paused: r<boolean>(d[13]) ?? false,
      protocolShareBps: Number(r<bigint>(d[14]) ?? 0n),
      minCollateral: r<bigint>(d[15]) ?? 0n,
      markets: perpMarkets,
      oiLong: ASSETS.map((_, i) => r<bigint>(d[19 + n + i]) ?? 0n),
      oiShort: ASSETS.map((_, i) => r<bigint>(d[19 + 2 * n + i]) ?? 0n),
    },
    options: {
      owner: r<Address>(d[16]) ?? null,
      paused: r<boolean>(d[17]) ?? false,
      protocolFeeBps: Number(r<bigint>(d[18]) ?? 0n),
      markets: optionMarkets,
      openNotional: ASSETS.map((_, i) => r<bigint>(d[19 + 4 * n + i]) ?? 0n),
      supportsDaily: r<bigint>(d[19 + 5 * n]) != null,
      daily: ASSETS.map((_, i) => r<boolean>(d[20 + 5 * n + i]) ?? false),
      shortDatedSpreadBps: Number(r<bigint>(d[19 + 5 * n]) ?? 0n),
    },
    prices,
    refetch: () => {
      poolCode.refetch()
      perpsCode.refetch()
      optionsCode.refetch()
      core.refetch()
      feedReads.refetch()
    },
    amount: (v: bigint) => Number(formatUnits(v, decimals)),
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useProtocol() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useProtocol must be used inside ProtocolProvider')
  return ctx
}
