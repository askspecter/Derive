// Agent Arena leaderboard, computed from the chain alone: the arena registry, the trade events of
// LarryPerps and LarryOptions, and their current state. Shared by the app and the Agent Kit.
import { getAbiItem, type Address, type PublicClient } from 'viem'
import { LarryArenaAbi, LarryOptionsAbi, LarryPerpsAbi } from './abis'

export interface ArenaAgent {
  address: Address
  name: string
  joinedAt: number
  hidden: boolean
  maxPerTrade: number
  maxPerDay: number
  firstPerpId: bigint
  firstOptionId: bigint
}

export interface ArenaTrade {
  kind: 'perp' | 'option'
  id: bigint
  marketId: number
  /** long or call */
  up: boolean
  /** USDG that left the wallet for this trade: collateral and fees, or premium and fee */
  cost: number
  /** open: still running; done: closed, liquidated, settled or claimed; pending: expired, waiting for settlement */
  state: 'open' | 'done' | 'pending'
  /** PnL in USDG. Open perps are marked at the Chainlink price; open and pending options count 0. */
  pnl: number
}

export interface ArenaEntry extends ArenaAgent {
  rank: number
  pnl: number
  realized: number
  unrealized: number
  /** USDG put into all trades */
  spent: number
  roi: number
  trades: number
  open: number
  wins: number
  losses: number
  biggestTrade: number
  withinLimits: boolean
  history: ArenaTrade[]
}

export interface ArenaBoard {
  arena: Address
  startBlock: bigint
  toBlock: bigint
  joinsPaused: boolean
  entries: ArenaEntry[]
}

export interface ArenaSource {
  arena: Address
  perps: Address
  options: Address
  /** Collateral token decimals (USDG has 6) */
  decimals: number
}

const ev = {
  opened: getAbiItem({ abi: LarryPerpsAbi, name: 'PositionOpened' }),
  added: getAbiItem({ abi: LarryPerpsAbi, name: 'CollateralAdded' }),
  closed: getAbiItem({ abi: LarryPerpsAbi, name: 'PositionClosed' }),
  liquidated: getAbiItem({ abi: LarryPerpsAbi, name: 'PositionLiquidated' }),
  bought: getAbiItem({ abi: LarryOptionsAbi, name: 'OptionBought' }),
}

/** Reads logs over a block range, splitting it when the RPC refuses a range that large. */
async function logsIn<T>(fetch: (from: bigint, to: bigint) => Promise<T[]>, from: bigint, to: bigint): Promise<T[]> {
  if (from > to) return []
  try {
    return await fetch(from, to)
  } catch (e) {
    if (to - from < 2_000n) throw e
    const mid = from + (to - from) / 2n
    return [...(await logsIn(fetch, from, mid)), ...(await logsIn(fetch, mid + 1n, to))]
  }
}

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

export async function readArenaAgents(client: PublicClient, arena: Address, decimals: number) {
  const [startBlock, count, joinsPaused] = await Promise.all([
    client.readContract({ address: arena, abi: LarryArenaAbi, functionName: 'startBlock' }),
    client.readContract({ address: arena, abi: LarryArenaAbi, functionName: 'agentCount' }),
    client.readContract({ address: arena, abi: LarryArenaAbi, functionName: 'joinsPaused' }),
  ])
  const unit = 10 ** decimals
  const agents: ArenaAgent[] = []
  for (let off = 0n; off < count; off += 200n) {
    const [addrs, info] = await client.readContract({ address: arena, abi: LarryArenaAbi, functionName: 'agents', args: [off, 200n] })
    addrs.forEach((a, i) =>
      agents.push({
        address: a,
        name: info[i].name,
        joinedAt: Number(info[i].joinedAt),
        hidden: info[i].hidden,
        maxPerTrade: Number(info[i].maxPerTrade) / unit,
        maxPerDay: Number(info[i].maxPerDay) / unit,
        firstPerpId: BigInt(info[i].firstPerpId),
        firstOptionId: BigInt(info[i].firstOptionId),
      }),
    )
  }
  return { startBlock, joinsPaused, agents }
}

/** Builds the leaderboard. Ranked by PnL: closed trades plus open perps marked at the oracle price. */
export async function loadArena(client: PublicClient, src: ArenaSource): Promise<ArenaBoard> {
  const { startBlock, joinsPaused, agents } = await readArenaAgents(client, src.arena, src.decimals)
  const toBlock = await client.getBlockNumber({ cacheTime: 0 })
  const unit = 10 ** src.decimals
  const usd = (v: bigint) => Number(v) / unit
  const byAddr = new Map(agents.map((a) => [a.address.toLowerCase(), a]))
  const owners = agents.map((a) => a.address)

  const perpLogs = async <E extends typeof ev.opened | typeof ev.closed | typeof ev.liquidated>(event: E) =>
    (
      await Promise.all(
        chunks(owners, 50).map((owner) =>
          logsIn((fromBlock, to) => client.getLogs({ address: src.perps, event, args: { owner } as never, fromBlock, toBlock: to }), startBlock, toBlock),
        ),
      )
    ).flat()

  const [opened, closed, liquidated, bought] = owners.length
    ? await Promise.all([
        perpLogs(ev.opened),
        perpLogs(ev.closed),
        perpLogs(ev.liquidated),
        Promise.all(
          chunks(owners, 50).map((owner) =>
            logsIn((fromBlock, to) => client.getLogs({ address: src.options, event: ev.bought, args: { owner }, fromBlock, toBlock: to }), startBlock, toBlock),
          ),
        ).then((x) => x.flat()),
      ])
    : [[], [], [], []]

  // Only positions opened after the agent joined.
  const counts = <T extends { args: { owner?: Address; id?: bigint } }>(logs: T[], key: 'firstPerpId' | 'firstOptionId') =>
    logs.filter((l) => {
      const a = byAddr.get(String(l.args.owner).toLowerCase())
      return !!a && l.args.id !== undefined && l.args.id >= a[key]
    })
  const opens = counts(opened as never[], 'firstPerpId') as typeof opened
  const buys = counts(bought as never[], 'firstOptionId') as typeof bought
  const perpIds = opens.map((l) => l.args.id!)

  const added = new Map<bigint, bigint>()
  for (const ids of chunks(perpIds, 100)) {
    const logs = await logsIn((fromBlock, to) => client.getLogs({ address: src.perps, event: ev.added, args: { id: ids }, fromBlock, toBlock: to }), startBlock, toBlock)
    for (const l of logs) added.set(l.args.id!, (added.get(l.args.id!) ?? 0n) + l.args.amount!)
  }
  const closedBy = new Map(closed.map((l) => [l.args.id!, l.args.paidToTrader!]))
  const liquidatedIds = new Set(liquidated.map((l) => l.args.id!))

  // Current state for open perps and every option.
  const openPerps = opens.filter((l) => !closedBy.has(l.args.id!) && !liquidatedIds.has(l.args.id!))
  const markets = [...new Set(openPerps.map((l) => l.args.marketId!))]
  const now = BigInt(Math.floor(Date.now() / 1000))
  const state = await client.multicall({
    allowFailure: true,
    contracts: [
      ...openPerps.map((l) => ({ address: src.perps, abi: LarryPerpsAbi, functionName: 'getPosition', args: [l.args.id!] }) as const),
      ...markets.map((m) => ({ address: src.perps, abi: LarryPerpsAbi, functionName: 'price', args: [m] }) as const),
      ...markets.map((m) => ({ address: src.perps, abi: LarryPerpsAbi, functionName: 'markets', args: [m] }) as const),
      ...buys.map((l) => ({ address: src.options, abi: LarryOptionsAbi, functionName: 'settlementPrice', args: [l.args.marketId!, l.args.expiry!] }) as const),
      ...buys.map((l) => ({ address: src.options, abi: LarryOptionsAbi, functionName: 'payoutOf', args: [l.args.id!] }) as const),
    ],
  })
  let k = 0
  const take = <T>(n: number) => state.slice(k, (k += n)).map((r) => (r.status === 'success' ? (r.result as T) : undefined))
  const positions = take<{ size: bigint; collateral: bigint; entryPrice: bigint; reserved: bigint; isLong: boolean; openedAt: bigint }>(openPerps.length)
  const pxs = take<bigint>(markets.length)
  const prices = new Map(markets.map((m, i) => [m, pxs[i]]))
  const cfgs = take<readonly unknown[]>(markets.length)
  const mkts = new Map(markets.map((m, i) => [m, cfgs[i]]))
  const settled = take<bigint>(buys.length)
  const payouts = take<bigint>(buys.length)

  const trades = new Map<string, ArenaTrade[]>(agents.map((a) => [a.address.toLowerCase(), []]))
  const push = (owner: Address | undefined, t: ArenaTrade) => trades.get(String(owner).toLowerCase())?.push(t)

  for (const l of opens) {
    const id = l.args.id!
    const cost = l.args.collateral! + l.args.fee! + (added.get(id) ?? 0n)
    const base = { kind: 'perp' as const, id, marketId: Number(l.args.marketId), up: !!l.args.isLong, cost: usd(cost) }
    if (closedBy.has(id)) push(l.args.owner, { ...base, state: 'done', pnl: usd(closedBy.get(id)! - cost) })
    else if (liquidatedIds.has(id)) push(l.args.owner, { ...base, state: 'done', pnl: -usd(cost) })
    else {
      const p = positions[openPerps.indexOf(l)]
      const px = prices.get(l.args.marketId!)
      const m = mkts.get(l.args.marketId!) as readonly [Address, number, number, number, number, number] | undefined
      let value: bigint | undefined
      if (p && px && m) {
        const diff = ((px - p.entryPrice) * p.size) / p.entryPrice
        let pnl = p.isLong ? diff : -diff
        if (pnl > p.reserved) pnl = p.reserved
        const borrow = (p.size * BigInt(m[5]) * (now - BigInt(p.openedAt))) / (10_000n * 86_400n)
        const closeFee = (p.size * BigInt(m[4])) / 10_000n
        value = p.collateral + pnl - borrow - closeFee
        if (value < 0n) value = 0n
        if (value > p.collateral + p.reserved) value = p.collateral + p.reserved
      }
      push(l.args.owner, { ...base, state: 'open', pnl: value === undefined ? 0 : usd(value - cost) })
    }
  }
  buys.forEach((l, i) => {
    const cost = l.args.premium! + l.args.fee!
    const base = { kind: 'option' as const, id: l.args.id!, marketId: Number(l.args.marketId), up: !!l.args.isCall, cost: usd(cost) }
    if (settled[i]) push(l.args.owner, { ...base, state: 'done', pnl: usd((payouts[i] ?? 0n) - cost) })
    else push(l.args.owner, { ...base, state: l.args.expiry! <= now ? 'pending' : 'open', pnl: 0 })
  })

  const entries: ArenaEntry[] = agents.map((a) => {
    const h = trades.get(a.address.toLowerCase()) ?? []
    const done = h.filter((t) => t.state === 'done')
    const realized = done.reduce((s, t) => s + t.pnl, 0)
    const unrealized = h.filter((t) => t.state === 'open').reduce((s, t) => s + t.pnl, 0)
    const spent = h.reduce((s, t) => s + t.cost, 0)
    const biggestTrade = h.reduce((m, t) => Math.max(m, t.cost), 0)
    return {
      ...a,
      rank: 0,
      pnl: realized + unrealized,
      realized,
      unrealized,
      spent,
      roi: spent > 0 ? (realized + unrealized) / spent : 0,
      trades: h.length,
      open: h.filter((t) => t.state !== 'done').length,
      wins: done.filter((t) => t.pnl > 0).length,
      losses: done.filter((t) => t.pnl <= 0).length,
      biggestTrade,
      // Fees can push a trade a hair over its cap, so allow one cent.
      withinLimits: biggestTrade <= a.maxPerTrade + 0.01,
      history: h.sort((x, y) => Number(y.id - x.id)),
    }
  })
  const ranked = entries.filter((e) => !e.hidden).sort((x, y) => y.pnl - x.pnl || y.roi - x.roi || x.joinedAt - y.joinedAt)
  ranked.forEach((e, i) => (e.rank = i + 1))
  return { arena: src.arena, startBlock, toBlock, joinsPaused, entries: [...ranked, ...entries.filter((e) => e.hidden)] }
}
