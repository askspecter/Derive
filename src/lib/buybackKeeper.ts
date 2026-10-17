// Runs the $LARRY buyback from a browser tab, so no server is needed. A keeper key lives in this
// browser's storage; the owner makes it the contract's keeper once and sends it a little ETH for gas.
// While the tab is open it triggers a buy every few seconds: on the $LARRY Pons pool through the
// contract's buyAndBurn (the default), or on a Uniswap V4 pool through buyAndBurnV4. The ETH budget and every limit stay
// in the LarryBuyback contract, so the key can only trigger buys the contract allows.
import { useEffect, useRef, useState } from 'react'
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, encodeFunctionData, formatEther, hexToBigInt, http, parseAbi, parseAbiItem, toEventSelector, parseEther, zeroAddress, type Account, type Address, type Hash, type Hex, type PublicClient, type WalletClient } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { RPC_URL } from '../config/protocol'
import { LarryBuybackAbi } from './abis'
import { LARRY_POOL } from '../config/token'

/** The $LARRY Pons pool's buy: pays ETH, sends $LARRY to `to`. */
const PONS = parseAbi(['function buy(uint256 ethIn, uint256 minOut, address to) payable returns (uint256)'])

const KEY = 'larry:buyback-keeper'
const rpc = RPC_URL ?? ROBINHOOD_CHAIN.rpcUrl
const chain = defineChain({ id: ROBINHOOD_CHAIN.id, name: ROBINHOOD_CHAIN.name, nativeCurrency: ROBINHOOD_CHAIN.nativeCurrency, rpcUrls: { default: { http: [rpc] } } })

export function keeperKey(create = false): Hex | null {
  try {
    let k = localStorage.getItem(KEY)
    if (!k && create) {
      k = generatePrivateKey()
      localStorage.setItem(KEY, k)
    }
    return k && /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : null
  } catch {
    return null
  }
}

export interface KeeperLog {
  t: number
  ok: boolean
  text: string
  hash?: Hash
}

export interface KeeperSettings {
  /** pons: buy on the $LARRY Pons pool through the contract's buyAndBurn. v4: buyAndBurnV4. */
  route: 'pons' | 'v4'
  everySec: number
  amountEth: string
  jitter: number
  slippageBps: number
}

// Its own client: plain RPC calls, no multicall batching, so every read and simulation is exact.
const keeperClient = createPublicClient({ chain, transport: http(rpc) })

export type TickResult = { ok: true; burned: number; value: bigint; hash: Hash } | { ok: false; text: string }

/** One buyback: reads the contract's limits, quotes, and sends the buy. Used by the hook and by tests. */
export async function keeperTick(pub: PublicClient, wallet: WalletClient, account: Account, contract: Address, s: KeeperSettings): Promise<TickResult> {
  const c = { address: contract, abi: LarryBuybackAbi } as const
  const [left, perBuy, held, gas] = await Promise.all([
    pub.readContract({ ...c, functionName: 'leftToday' }),
    pub.readContract({ ...c, functionName: 'maxPerBuy' }),
    pub.getBalance({ address: contract }),
    pub.getBalance({ address: account.address }),
  ])
  const base = parseEther(s.amountEth || '0')
  let value = (base * BigInt(Math.round((1 - s.jitter + Math.random() * 2 * s.jitter) * 1e6))) / 1_000_000n
  for (const cap of [left, perBuy, held]) if (value > cap) value = cap
  if (value <= 0n) return { ok: false, text: held === 0n ? 'The contract has no ETH left. Fund it.' : 'Daily limit reached. Waiting for tomorrow (UTC).' }
  if (gas < parseEther('0.00002')) return { ok: false, text: `Keeper is low on gas (${formatEther(gas)} ETH). Send it a little ETH.` }
  let quote: bigint
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let request: any
  if (s.route === 'pons') {
    // Quote: what the pool would pay the contract for this much ETH.
    const q = await pub.call({ account: contract, to: LARRY_POOL, value, data: encodeFunctionData({ abi: PONS, functionName: 'buy', args: [value, 0n, contract] }) })
    quote = hexToBigInt(q.data!)
    const minOut = (quote * BigInt(10_000 - s.slippageBps)) / 10_000n
    const data = encodeFunctionData({ abi: PONS, functionName: 'buy', args: [value, minOut, contract] })
    ;({ request } = await pub.simulateContract({ ...c, account, functionName: 'buyAndBurn', args: [LARRY_POOL, data, value, minOut] }))
  } else {
    ;({ result: quote } = await pub.simulateContract({ ...c, account, functionName: 'buyAndBurnV4', args: [value, 0n] }))
    const minOut = (quote * BigInt(10_000 - s.slippageBps)) / 10_000n
    ;({ request } = await pub.simulateContract({ ...c, account, functionName: 'buyAndBurnV4', args: [value, minOut] }))
  }
  const hash = await wallet.writeContract(request)
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error('The buy reverted')
  return { ok: true, burned: Number(formatEther(quote)), value, hash }
}

/** The keeper loop. `running` survives only while the tab is open. */
export function useBrowserKeeper(contract: Address | null) {
  const pub = keeperClient as PublicClient
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<KeeperLog[]>([])
  const [stats, setStats] = useState({ buys: 0, burned: 0 })
  const settings = useRef<KeeperSettings>({ route: 'pons', everySec: 10, amountEth: '0.00001', jitter: 0.3, slippageBps: 300 })
  const add = (l: Omit<KeeperLog, 't'>) => setLog((x) => [{ ...l, t: Date.now() }, ...x].slice(0, 40))

  useEffect(() => {
    if (!running || !contract) return
    const key = keeperKey()
    if (!key) return
    const account = privateKeyToAccount(key)
    const wallet = createWalletClient({ account, chain, transport: http(rpc) })
    let stop = false
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      const started = Date.now()
      try {
        const r = await keeperTick(pub, wallet, account, contract, settings.current)
        if (r.ok) {
          setStats((x) => ({ buys: x.buys + 1, burned: x.burned + r.burned }))
          add({ ok: true, text: `Burned ~${Math.round(r.burned).toLocaleString('en-US')} LARRY for ${Number(formatEther(r.value)).toPrecision(3)} ETH`, hash: r.hash })
        } else add(r)
      } catch (e) {
        const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? String(e)
        add({ ok: false, text: msg.length > 160 ? `${msg.slice(0, 160)}…` : msg })
      }
      if (!stop) timer = setTimeout(tick, Math.max(1000, settings.current.everySec * 1000 - (Date.now() - started)))
    }
    tick()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [running, contract, pub])

  return { running, setRunning, log, stats, settings }
}

const v4Swap = parseAbiItem('event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)')
const v4Init = parseAbiItem('event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)')

/** Reads the Uniswap V4 pool of a $LARRY buy: its PoolManager and pool key. */
export async function findV4Pool(pub: PublicClient, hash: Hash) {
  const r = await pub.getTransactionReceipt({ hash })
  const sel = toEventSelector(v4Swap)
  const log = r.logs.find((l) => l.topics[0] === sel)
  if (!log) throw new Error('No Uniswap V4 swap in that transaction')
  const swap = { address: log.address, args: decodeEventLog({ abi: [v4Swap], data: log.data, topics: log.topics }).args }
  const id = swap.args.id
  const latest = r.blockNumber
  const find = async (from: bigint, to: bigint): Promise<{ currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address } | null> => {
    try {
      const ls = await pub.getLogs({ address: swap.address, event: v4Init, args: { id }, fromBlock: from, toBlock: to })
      return ls[0] ? (ls[0].args as never) : null
    } catch (e) {
      if (to - from < 5_000n) throw e
      const mid = from + (to - from) / 2n
      return (await find(mid + 1n, to)) ?? (await find(from, mid))
    }
  }
  const key = await find(0n, latest)
  if (!key) throw new Error('Found the swap but not the pool setup. Enter the values by hand.')
  return { poolManager: swap.address, id, key: { ...key, currency0: key.currency0 ?? zeroAddress } }
}
