// Hyperliquid perps from the Larry app. Market data is public. Trading uses two signatures from the
// trader's wallet, once: approve Larry's builder fee, and approve a trading key that lives in this
// browser. That key signs orders with no wallet popups and cannot withdraw funds (Hyperliquid API
// wallets can only trade). Orders go straight to the Hyperliquid API; Larry never holds the funds.
import { useQuery } from '@tanstack/react-query'
import { ExchangeClient, HttpTransport, InfoClient } from '@nktkas/hyperliquid'
import { formatPrice, formatSize } from '@nktkas/hyperliquid/utils'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Address, Hex, WalletClient } from 'viem'
import { HL_BUILDER, HL_BUILDER_FEE, HL_BUILDER_FEE_PCT, HL_SLIPPAGE, HL_TESTNET } from '../config/hyperliquid'

export const hlTransport = new HttpTransport({ isTestnet: HL_TESTNET })
export const hlInfo = new InfoClient({ transport: hlTransport })

export interface HlMarket {
  /** Asset index used in orders */
  asset: number
  coin: string
  szDecimals: number
  maxLeverage: number
  mark: number
  mid: number
  oracle: number
  prevDay: number
  change: number
  volume: number
  openInterest: number
  /** Hourly funding rate, as a fraction */
  funding: number
}

export function useHlMarkets() {
  return useQuery({
    queryKey: ['hl', 'markets', HL_TESTNET],
    queryFn: async (): Promise<HlMarket[]> => {
      const [meta, ctxs] = await hlInfo.metaAndAssetCtxs()
      return meta.universe
        .map((u, i) => {
          const c = ctxs[i]
          const mark = Number(c.markPx)
          const prevDay = Number(c.prevDayPx)
          return {
            asset: i,
            coin: u.name,
            szDecimals: u.szDecimals,
            maxLeverage: u.maxLeverage,
            mark,
            mid: Number(c.midPx ?? c.markPx),
            oracle: Number(c.oraclePx),
            prevDay,
            change: prevDay ? mark / prevDay - 1 : 0,
            volume: Number(c.dayNtlVlm),
            openInterest: Number(c.openInterest) * mark,
            funding: Number(c.funding),
            delisted: !!(u as { isDelisted?: boolean }).isDelisted,
          }
        })
        .filter((m) => !m.delisted && m.mark > 0)
        .sort((a, b) => b.volume - a.volume)
    },
    refetchInterval: 5_000,
    staleTime: 2_000,
  })
}

export function useHlCandles(coin: string | undefined) {
  return useQuery({
    queryKey: ['hl', 'candles', HL_TESTNET, coin],
    enabled: !!coin,
    queryFn: async () => {
      const now = Date.now()
      const cs = await hlInfo.candleSnapshot({ coin: coin!, interval: '1h', startTime: now - 3 * 86_400_000, endTime: now })
      return cs.map((c) => ({ t: Math.floor(c.t / 1000), p: Number(c.c) }))
    },
    refetchInterval: 60_000,
  })
}

export interface HlPosition {
  coin: string
  size: number
  entry: number
  value: number
  pnl: number
  roe: number
  liq: number | null
  leverage: number
  cross: boolean
  margin: number
}

export function useHlAccount(user: Address | null) {
  return useQuery({
    queryKey: ['hl', 'account', HL_TESTNET, user],
    enabled: !!user,
    queryFn: async () => {
      const [state, orders, builderFee, agents] = await Promise.all([
        hlInfo.clearinghouseState({ user: user! }),
        hlInfo.openOrders({ user: user! }),
        HL_BUILDER ? hlInfo.maxBuilderFee({ user: user!, builder: HL_BUILDER }) : Promise.resolve(0),
        hlInfo.extraAgents({ user: user! }),
      ])
      const key = loadAgentKey(user!)
      const agent = key ? privateKeyToAccount(key).address.toLowerCase() : null
      const positions: HlPosition[] = state.assetPositions
        .map(({ position: p }) => ({
          coin: p.coin,
          size: Number(p.szi),
          entry: Number(p.entryPx),
          value: Number(p.positionValue),
          pnl: Number(p.unrealizedPnl),
          roe: Number(p.returnOnEquity),
          liq: p.liquidationPx ? Number(p.liquidationPx) : null,
          leverage: p.leverage.value,
          cross: p.leverage.type === 'cross',
          margin: Number(p.marginUsed),
        }))
        .filter((p) => p.size !== 0)
      return {
        accountValue: Number(state.marginSummary.accountValue),
        withdrawable: Number(state.withdrawable),
        positions,
        openOrders: orders.length,
        builderApproved: !HL_BUILDER || Number(builderFee) >= HL_BUILDER_FEE,
        agentApproved: !!agent && agents.some((a) => a.address.toLowerCase() === agent && (!a.validUntil || a.validUntil > Date.now())),
      }
    },
    refetchInterval: 5_000,
  })
}

// ------------------------------------------------------------ trading key

const keyName = (user: Address) => `larry:hl-agent:${HL_TESTNET ? 'test:' : ''}${user.toLowerCase()}`

export function loadAgentKey(user: Address): Hex | null {
  try {
    const k = localStorage.getItem(keyName(user))
    return k && /^0x[0-9a-fA-F]{64}$/.test(k) ? (k as Hex) : null
  } catch {
    return null
  }
}

/** One time setup from the trader's wallet: Larry's builder fee, then a trading key for this browser. */
export async function enableHlTrading(wallet: WalletClient, user: Address, needBuilder: boolean, onStep: (label: string) => void) {
  const exchange = new ExchangeClient({ transport: hlTransport, wallet: wallet as never })
  if (needBuilder && HL_BUILDER) {
    onStep(`Approve Larry's ${HL_BUILDER_FEE_PCT} builder fee in your wallet`)
    await exchange.approveBuilderFee({ maxFeeRate: HL_BUILDER_FEE_PCT, builder: HL_BUILDER })
  }
  const key = loadAgentKey(user) ?? generatePrivateKey()
  onStep('Approve the Larry trading key in your wallet')
  await exchange.approveAgent({ agentAddress: privateKeyToAccount(key).address, agentName: 'Larry' })
  localStorage.setItem(keyName(user), key)
}

function agentExchange(user: Address) {
  const key = loadAgentKey(user)
  if (!key) throw new Error('Enable Hyperliquid trading first.')
  return new ExchangeClient({ transport: hlTransport, wallet: privateKeyToAccount(key) })
}

const builder = () => (HL_BUILDER && HL_BUILDER_FEE > 0 ? { b: HL_BUILDER, f: HL_BUILDER_FEE } : undefined)

/** Market order: an immediate or cancel limit order at most HL_SLIPPAGE away from the mid price. */
export async function hlMarketOrder(user: Address, m: HlMarket, p: { long: boolean; size: number; leverage?: number; cross?: boolean; reduceOnly?: boolean }) {
  const ex = agentExchange(user)
  if (p.leverage) await ex.updateLeverage({ asset: m.asset, isCross: p.cross ?? true, leverage: p.leverage })
  const px = formatPrice(m.mid * (p.long ? 1 + HL_SLIPPAGE : 1 - HL_SLIPPAGE), m.szDecimals)
  const res = await ex.order({
    orders: [{ a: m.asset, b: p.long, p: px, s: formatSize(p.size, m.szDecimals), r: !!p.reduceOnly, t: { limit: { tif: 'Ioc' } } }],
    grouping: 'na',
    builder: builder(),
  })
  const st = res.response.data.statuses[0] as Record<string, unknown>
  if ('error' in st) throw new Error(String(st.error))
  if ('filled' in st) return st.filled as { totalSz: string; avgPx: string }
  throw new Error('The order did not fill. Try again.')
}

/** Closes a whole position with a reduce only market order. */
export const hlClose = (user: Address, m: HlMarket, pos: HlPosition) => hlMarketOrder(user, m, { long: pos.size < 0, size: Math.abs(pos.size), reduceOnly: true })

/** Readable message from a Hyperliquid API or wallet error. */
export function hlError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/User rejected|denied/i.test(msg)) return 'Request rejected in wallet.'
  if (/Builder fee has not been approved/i.test(msg)) return 'Approve the Larry builder fee first.'
  if (/does not exist|User or API Wallet/i.test(msg)) return 'The trading key is not approved on Hyperliquid. Enable trading again.'
  if (/Insufficient margin|insufficient/i.test(msg)) return 'Not enough margin on Hyperliquid. Deposit USDC to your Hyperliquid account first.'
  if (/Failed to fetch|NetworkError|TransportError/i.test(msg)) return 'Could not reach Hyperliquid. Try again.'
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg
}
