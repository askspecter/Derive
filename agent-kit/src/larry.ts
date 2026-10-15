// Larry SDK: reads and trades on the Larry contracts on Robinhood Chain.
// Used by the MCP server, and usable on its own from any TypeScript agent.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ASSETS, type Asset } from '../../src/config/markets'
import { LarryOptionsAbi, LarryPerpsAbi, LarryPoolAbi, aggregatorAbi } from '../../src/lib/abis'
import { strikesAround, validExpiries } from '../../src/lib/expiries'

/** Options contract with daily (0DTE) expiries, live on Robinhood Chain mainnet. */
export const DEFAULT_OPTIONS: Address = '0xF490083611b526a0fdFd39908DEAF7561F4629a2'
export const DEFAULT_RPC = 'https://rpc.mainnet.chain.robinhood.com'
export const EXPLORER = 'https://robinhoodchain.blockscout.com'
const OPTION_SLIPPAGE = 101n // pay at most 1% above the quote
const PERP_SLIPPAGE_BPS = 50n // 0.5% from the oracle price

export type Action = 'options' | 'perps' | 'vault'

export interface LarryConfig {
  rpcUrl?: string
  options?: Address
  perps?: Address
  pool?: Address
  /** Older options contracts whose options can still be claimed. */
  optionsLegacy?: Address[]
  /** Signs trades. Without it the kit is read only. */
  privateKey?: Hex
  /** Spending caps in collateral units (USDG), enforced before anything is sent. */
  maxPerTrade?: number
  maxPerDay?: number
  allow?: Action[]
  /** Simulate writes and return a preview without sending them. */
  dryRun?: boolean
  stateDir?: string
}

const addr = (v: string | undefined) => (v && isAddress(v.trim()) ? getAddress(v.trim()) : undefined)

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): LarryConfig {
  const allow = (env.LARRY_ALLOW ?? 'options,perps,vault')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Action => s === 'options' || s === 'perps' || s === 'vault')
  return {
    rpcUrl: env.LARRY_RPC_URL || DEFAULT_RPC,
    options: addr(env.LARRY_OPTIONS) ?? DEFAULT_OPTIONS,
    perps: addr(env.LARRY_PERPS),
    pool: addr(env.LARRY_POOL),
    optionsLegacy: (env.LARRY_OPTIONS_LEGACY ?? '').split(',').map(addr).filter((a): a is Address => !!a),
    privateKey: env.LARRY_PRIVATE_KEY ? ((env.LARRY_PRIVATE_KEY.startsWith('0x') ? env.LARRY_PRIVATE_KEY : `0x${env.LARRY_PRIVATE_KEY}`) as Hex) : undefined,
    maxPerTrade: Number(env.LARRY_MAX_PER_TRADE ?? 100),
    maxPerDay: Number(env.LARRY_MAX_PER_DAY ?? 500),
    allow,
    dryRun: env.LARRY_DRY_RUN === '1' || env.LARRY_DRY_RUN === 'true',
    stateDir: env.LARRY_STATE_DIR || path.join(os.homedir(), '.larry-agent'),
  }
}

export const robinhoodChain = (rpcUrl: string) =>
  defineChain({
    id: 4663,
    name: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: 'Blockscout', url: EXPLORER } },
    contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
  })

export class LarryError extends Error {}

/** OpenZeppelin ERC20 errors, so token reverts decode to a name. */
const ERC20_ERRORS = [
  { type: 'error', name: 'ERC20InsufficientAllowance', inputs: [{ name: 'spender', type: 'address' }, { name: 'allowance', type: 'uint256' }, { name: 'needed', type: 'uint256' }] },
  { type: 'error', name: 'ERC20InsufficientBalance', inputs: [{ name: 'sender', type: 'address' }, { name: 'balance', type: 'uint256' }, { name: 'needed', type: 'uint256' }] },
] as const

const REVERTS: Record<string, string> = {
  ERC20InsufficientBalance: 'The agent wallet does not have enough USDG for this.',
  ERC20InsufficientAllowance: 'USDG allowance is too low.',
  InsufficientFreeLiquidity: 'Not enough free liquidity in the Larry Vault for this trade.',
  StalePrice: 'The oracle price is stale. The market may be closed.',
  SlippageExceeded: 'The price moved beyond the slippage limit. Try again.',
  BadLeverage: 'Leverage is outside the allowed range.',
  CollateralTooSmall: 'Collateral is below the minimum.',
  OpenInterestCap: 'This market reached its open interest cap.',
  NotionalCap: 'This options market reached its open notional cap.',
  PremiumTooHigh: 'The premium moved above the limit. Try again.',
  Paused: 'Trading is paused.',
  MarketDisabled: 'This market is not listed.',
  BadExpiry: 'That expiry cannot be bought.',
  BadStrike: 'Strike must be between half and twice the current price.',
  NotExpired: 'Not expired yet.',
  NotSettled: 'This expiry is not settled yet.',
  AlreadyExercised: 'Already claimed.',
  ERC4626ExceededMaxDeposit: 'Deposit is above the vault cap.',
  ERC4626ExceededMaxWithdraw: 'Withdrawal is above what is unlocked and free.',
}

function explain(e: unknown): never {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError)
    if (r instanceof ContractFunctionRevertedError) {
      const name = r.data?.errorName ?? r.reason
      if (name) throw new LarryError(REVERTS[name] ?? `Reverted: ${name}`)
    }
    throw new LarryError(e.shortMessage)
  }
  throw e
}

function findAsset(symbol: string): Asset {
  const a = ASSETS.find((x) => x.symbol.toLowerCase() === symbol.trim().toLowerCase())
  if (!a) throw new LarryError(`Unknown market ${symbol}. Markets: ${ASSETS.map((x) => x.symbol).join(', ')}`)
  return a
}

const num = (v: bigint, decimals: number) => Number(formatUnits(v, decimals))
const iso = (ts: number | bigint) => new Date(Number(ts) * 1000).toISOString().replace('.000Z', 'Z')

export class Larry {
  readonly cfg: Required<Omit<LarryConfig, 'perps' | 'pool' | 'privateKey'>> & Pick<LarryConfig, 'perps' | 'pool' | 'privateKey'>
  readonly pub
  readonly wallet
  readonly account
  private _pool?: Address
  private _token?: { address: Address; symbol: string; decimals: number }

  constructor(cfg: LarryConfig = configFromEnv()) {
    const d = configFromEnv({})
    this.cfg = { ...d, ...Object.fromEntries(Object.entries(cfg).filter(([, v]) => v !== undefined)) } as Larry['cfg']
    const chain = robinhoodChain(this.cfg.rpcUrl)
    this.pub = createPublicClient({ chain, transport: http(this.cfg.rpcUrl) })
    this.account = this.cfg.privateKey ? privateKeyToAccount(this.cfg.privateKey) : undefined
    this.wallet = this.account ? createWalletClient({ account: this.account, chain, transport: http(this.cfg.rpcUrl) }) : undefined
  }

  // ------------------------------------------------------------- basics

  async pool(): Promise<Address> {
    if (this._pool) return this._pool
    this._pool = this.cfg.pool ?? (await this.pub.readContract({ address: this.cfg.options, abi: LarryOptionsAbi, functionName: 'pool' }))
    return this._pool
  }

  async token() {
    if (this._token) return this._token
    const address = await this.pub.readContract({ address: await this.pool(), abi: LarryPoolAbi, functionName: 'asset' })
    const [symbol, decimals] = await Promise.all([
      this.pub.readContract({ address, abi: erc20Abi, functionName: 'symbol' }),
      this.pub.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
    ])
    this._token = { address, symbol, decimals }
    return this._token
  }

  private perpsAddress(): Address {
    if (!this.cfg.perps) throw new LarryError('Perps contract not configured. Set LARRY_PERPS to the LarryPerps address (see larry.exchange/#/docs/contracts).')
    return this.cfg.perps
  }

  /** Every listed market with its oracle price and what can be traded on it. */
  async markets() {
    const perps = this.cfg.perps
    const opt = this.cfg.options
    const calls = ASSETS.flatMap((a) => [
      { address: opt, abi: LarryOptionsAbi, functionName: 'markets', args: [BigInt(a.id)] },
      { address: opt, abi: LarryOptionsAbi, functionName: 'dailyExpiries', args: [BigInt(a.id)] },
      { address: perps ?? zeroAddress, abi: LarryPerpsAbi, functionName: 'markets', args: [BigInt(a.id)] },
    ])
    const r = await this.pub.multicall({ contracts: calls as never[], allowFailure: true })
    const listed = ASSETS.map((a, i) => {
      const om = r[3 * i].status === 'success' ? (r[3 * i].result as unknown as readonly unknown[]) : undefined
      const pm = perps && r[3 * i + 2].status === 'success' ? (r[3 * i + 2].result as unknown as readonly unknown[]) : undefined
      const optionsOn = !!om && om[0] !== zeroAddress && om[7] === true
      const perpsOn = !!pm && pm[0] !== zeroAddress && pm[10] === true
      return { a, om, pm, optionsOn, perpsOn, daily: r[3 * i + 1].result === true, feed: ((pm?.[0] ?? om?.[0]) as Address | undefined) }
    }).filter((m) => m.optionsOn || m.perpsOn)
    const prices = await this.pub.multicall({
      contracts: listed.flatMap((m) => [
        { address: m.feed!, abi: aggregatorAbi, functionName: 'latestRoundData' },
        { address: m.feed!, abi: aggregatorAbi, functionName: 'decimals' },
      ]) as never[],
      allowFailure: true,
    })
    const now = Date.now() / 1000
    return listed.map((m, i) => {
      const round = prices[2 * i].result as readonly bigint[] | undefined
      const dec = prices[2 * i + 1].result as number | undefined
      const price = round && dec != null ? num(round[1], dec) : null
      return {
        symbol: m.a.symbol,
        name: m.a.name,
        kind: m.a.kind,
        price,
        priceUpdated: round ? iso(round[3]) : null,
        priceAgeMinutes: round ? Math.round((now - Number(round[3])) / 60) : null,
        options: m.optionsOn
          ? { impliedVol: Number(formatUnits(m.om![2] as bigint, 18)), dailyExpiries: m.daily, maxExpiryDays: Number(m.om![5]) / 86400 }
          : null,
        perps: m.perpsOn ? { maxLeverage: Number(m.pm![2]), openFeeBps: Number(m.pm![3]), closeFeeBps: Number(m.pm![4]) } : null,
      }
    })
  }

  async price(symbol: string) {
    const all = await this.markets()
    const m = all.find((x) => x.symbol === findAsset(symbol).symbol)
    if (!m) throw new LarryError(`${symbol} is not listed on Larry`)
    return m
  }

  // ------------------------------------------------------------ options

  private async optionMarket(symbol: string) {
    const a = findAsset(symbol)
    const [m, daily] = await Promise.all([
      this.pub.readContract({ address: this.cfg.options, abi: LarryOptionsAbi, functionName: 'markets', args: [BigInt(a.id)] }),
      this.pub.readContract({ address: this.cfg.options, abi: LarryOptionsAbi, functionName: 'dailyExpiries', args: [BigInt(a.id)] }).catch(() => false),
    ])
    if (m[0] === zeroAddress || !m[7]) throw new LarryError(`${a.symbol} options are not listed`)
    return { a, maxExpiry: Number(m[5]), daily: daily === true }
  }

  /** Expiries that can be bought now. `zeroDte` marks the ones less than a day away. */
  async expiries(symbol: string) {
    const { a, maxExpiry, daily } = await this.optionMarket(symbol)
    const now = Number((await this.pub.getBlock()).timestamp)
    return { symbol: a.symbol, dailyExpiries: daily, expiries: validExpiries(maxExpiry, daily, now).map((e) => ({ expiry: e.ts, date: iso(e.ts), zeroDte: e.zeroDte, daysLeft: +e.days.toFixed(2) })) }
  }

  /** Resolves "0dte", "next", "friday", a date like 2026-10-16, or unix seconds to a listed expiry. */
  async resolveExpiry(symbol: string, input: string | number): Promise<number> {
    const { expiries } = await this.expiries(symbol)
    if (!expiries.length) throw new LarryError('No expiries available')
    const s = String(input).trim().toLowerCase()
    if (s === '0dte' || s === 'next' || s === 'today') return expiries[0].expiry
    if (s === 'friday' || s === 'weekly') {
      const f = expiries.find((e) => new Date(e.expiry * 1000).getUTCDay() === 5)
      if (f) return f.expiry
    }
    const asNum = Number(s)
    const target = Number.isFinite(asNum) && asNum > 1e9 ? asNum : Date.parse(s.length === 10 ? `${s}T08:00:00Z` : s) / 1000
    const hit = expiries.find((e) => e.expiry === target)
    if (!hit) throw new LarryError(`Not a listed expiry: ${input}. Listed: ${expiries.map((e) => e.date).join(', ')}`)
    return hit.expiry
  }

  async quoteOption(p: { symbol: string; type: 'call' | 'put'; strike: number; expiry: string | number; contracts: number }) {
    const { a } = await this.optionMarket(p.symbol)
    const t = await this.token()
    const expiry = await this.resolveExpiry(a.symbol, p.expiry)
    const strike = parseUnits(String(p.strike), 18)
    const amount = parseUnits(String(p.contracts), 18)
    const [premium, fee, maxPayout] = await this.pub.readContract({
      address: this.cfg.options,
      abi: LarryOptionsAbi,
      functionName: 'quote',
      args: [BigInt(a.id), p.type === 'call', strike, BigInt(expiry), amount],
    })
    const perContract = num(premium, t.decimals) / p.contracts
    return {
      symbol: a.symbol,
      type: p.type,
      strike: p.strike,
      expiry,
      expiryDate: iso(expiry),
      contracts: p.contracts,
      premium: num(premium, t.decimals),
      fee: num(fee, t.decimals),
      totalCost: num(premium + fee, t.decimals),
      maxPayout: num(maxPayout, t.decimals),
      breakeven: p.type === 'call' ? p.strike + perContract : p.strike - perContract,
      maxLoss: num(premium + fee, t.decimals),
      currency: t.symbol,
      raw: { marketId: BigInt(a.id), isCall: p.type === 'call', strike, expiry: BigInt(expiry), amount, cost: premium + fee },
    }
  }

  /** Calls and puts around the current price for one expiry, quoted onchain. */
  async optionChain(symbol: string, expiry: string | number = '0dte') {
    const { a } = await this.optionMarket(symbol)
    const t = await this.token()
    const exp = await this.resolveExpiry(a.symbol, expiry)
    const spot = (await this.price(a.symbol)).price ?? 0
    const strikes = strikesAround(Number(spot.toPrecision(2)), 5)
    const one = parseUnits('1', 18)
    const q = await this.pub.multicall({
      contracts: strikes.flatMap((k) =>
        [true, false].map((isCall) => ({
          address: this.cfg.options,
          abi: LarryOptionsAbi,
          functionName: 'quote',
          args: [BigInt(a.id), isCall, parseUnits(String(k), 18), BigInt(exp), one],
        })),
      ) as never[],
      allowFailure: true,
    })
    const cost = (r: (typeof q)[number]) => (r.status === 'success' ? num((r.result as bigint[])[0] + (r.result as bigint[])[1], t.decimals) : null)
    return {
      symbol: a.symbol,
      spot,
      expiry: exp,
      expiryDate: iso(exp),
      currency: t.symbol,
      note: 'Cost per 1 contract (premium plus fee). One contract pays (price minus strike) for a call or (strike minus price) for a put at expiry.',
      strikes: strikes.map((k, i) => ({ strike: k, call: cost(q[2 * i]), put: cost(q[2 * i + 1]) })),
    }
  }

  // ------------------------------------------------------------ account

  /** Address the kit trades from, or the one passed in. */
  owner(address?: string): Address {
    const a = addr(address) ?? this.account?.address
    if (!a) throw new LarryError('No wallet: pass an address, or set LARRY_PRIVATE_KEY to trade.')
    return a
  }

  async balances(address?: string) {
    const me = this.owner(address)
    const t = await this.token()
    const pool = await this.pool()
    const [usdg, eth, shares] = await Promise.all([
      this.pub.readContract({ address: t.address, abi: erc20Abi, functionName: 'balanceOf', args: [me] }),
      this.pub.getBalance({ address: me }),
      this.pub.readContract({ address: pool, abi: LarryPoolAbi, functionName: 'balanceOf', args: [me] }),
    ])
    const vaultValue = shares > 0n ? await this.pub.readContract({ address: pool, abi: LarryPoolAbi, functionName: 'convertToAssets', args: [shares] }) : 0n
    return {
      address: me,
      [t.symbol]: num(usdg, t.decimals),
      ETH: num(eth, 18),
      vaultShares: num(shares, 18),
      vaultValue: num(vaultValue, t.decimals),
      limits: this.account && me === this.account.address ? this.limits() : undefined,
    }
  }

  async positions(address?: string) {
    const me = this.owner(address)
    const t = await this.token()
    const now = Date.now() / 1000
    const perps: unknown[] = []
    if (this.cfg.perps) {
      const ids = await this.pub.readContract({ address: this.cfg.perps, abi: LarryPerpsAbi, functionName: 'positionIdsOf', args: [me] })
      for (const id of ids) {
        const p = await this.pub.readContract({ address: this.cfg.perps, abi: LarryPerpsAbi, functionName: 'getPosition', args: [id] })
        if (p.size === 0n) continue
        const s = await this.pub.readContract({ address: this.cfg.perps, abi: LarryPerpsAbi, functionName: 'positionState', args: [id] }).catch(() => null)
        perps.push({
          id: Number(id),
          market: ASSETS.find((x) => x.id === p.marketId)?.symbol,
          side: p.isLong ? 'long' : 'short',
          size: num(p.size, t.decimals),
          collateral: num(p.collateral, t.decimals),
          entryPrice: num(p.entryPrice, 18),
          markPrice: s ? num(s[0], 18) : null,
          pnl: s ? num(s[1], t.decimals) : null,
          equity: s ? num(s[3], t.decimals) : null,
        })
      }
    }
    const options: unknown[] = []
    for (const contract of [this.cfg.options, ...this.cfg.optionsLegacy]) {
      const ids = await this.pub.readContract({ address: contract, abi: LarryOptionsAbi, functionName: 'optionIdsOf', args: [me] }).catch(() => [] as readonly bigint[])
      for (const id of ids) {
        const [o, payout] = await Promise.all([
          this.pub.readContract({ address: contract, abi: LarryOptionsAbi, functionName: 'getOption', args: [id] }),
          this.pub.readContract({ address: contract, abi: LarryOptionsAbi, functionName: 'payoutOf', args: [id] }),
        ])
        const settle = await this.pub.readContract({ address: contract, abi: LarryOptionsAbi, functionName: 'settlementPrice', args: [BigInt(o.marketId), o.expiry] })
        const expired = Number(o.expiry) <= now
        options.push({
          id: Number(id),
          contract,
          market: ASSETS.find((x) => x.id === o.marketId)?.symbol,
          type: o.isCall ? 'call' : 'put',
          strike: num(o.strike, 18),
          expiryDate: iso(o.expiry),
          contracts: num(o.amount, 18),
          paid: num(o.premium, t.decimals),
          status: o.exercised ? 'claimed' : settle > 0n ? 'settled' : expired ? 'awaiting settlement' : 'active',
          settlementPrice: settle > 0n ? num(settle, 18) : null,
          payout: settle > 0n || o.exercised ? num(payout, t.decimals) : null,
          claimable: !o.exercised && expired,
        })
      }
    }
    return { address: me, currency: t.symbol, perps, options }
  }

  async vault() {
    const pool = await this.pool()
    const t = await this.token()
    const [assets, reserved, cap, lock] = await Promise.all([
      this.pub.readContract({ address: pool, abi: LarryPoolAbi, functionName: 'totalAssets' }),
      this.pub.readContract({ address: pool, abi: LarryPoolAbi, functionName: 'totalReserved' }),
      this.pub.readContract({ address: pool, abi: LarryPoolAbi, functionName: 'depositCap' }),
      this.pub.readContract({ address: pool, abi: LarryPoolAbi, functionName: 'lockPeriod' }),
    ])
    return {
      address: pool,
      currency: t.symbol,
      totalValueLocked: num(assets, t.decimals),
      reservedForOpenTrades: num(reserved, t.decimals),
      utilization: assets > 0n ? Number((reserved * 10_000n) / assets) / 100 : 0,
      depositCap: num(cap, t.decimals),
      depositLockHours: Number(lock) / 3600,
    }
  }

  // ------------------------------------------------------------- limits

  private statePath() {
    return path.join(this.cfg.stateDir, `spend-${(this.account?.address ?? 'none').toLowerCase()}.json`)
  }
  private spentToday(): number {
    try {
      const s = JSON.parse(fs.readFileSync(this.statePath(), 'utf8'))
      return s.day === new Date().toISOString().slice(0, 10) ? Number(s.spent) || 0 : 0
    } catch {
      return 0
    }
  }
  private recordSpend(amount: number) {
    const day = new Date().toISOString().slice(0, 10)
    fs.mkdirSync(this.cfg.stateDir, { recursive: true })
    fs.writeFileSync(this.statePath(), JSON.stringify({ day, spent: this.spentToday() + amount }))
  }
  limits() {
    const spent = this.spentToday()
    return { maxPerTrade: this.cfg.maxPerTrade, maxPerDay: this.cfg.maxPerDay, spentToday: spent, leftToday: Math.max(0, this.cfg.maxPerDay - spent), allow: this.cfg.allow, dryRun: this.cfg.dryRun }
  }
  private guard(action: Action, spend: number) {
    if (!this.wallet || !this.account) throw new LarryError('Read only: set LARRY_PRIVATE_KEY to an agent wallet to trade.')
    if (!this.cfg.allow.includes(action)) throw new LarryError(`${action} is not allowed for this agent (LARRY_ALLOW=${this.cfg.allow.join(',')}).`)
    if (spend > this.cfg.maxPerTrade) throw new LarryError(`This trade spends ${spend.toFixed(2)}, above the per trade limit of ${this.cfg.maxPerTrade}.`)
    if (this.spentToday() + spend > this.cfg.maxPerDay) throw new LarryError(`Daily limit reached: ${this.spentToday().toFixed(2)} of ${this.cfg.maxPerDay} spent today.`)
  }

  // ------------------------------------------------------------- writes

  /** Set when a dry run skipped an approval, so later steps can't be simulated against it. */
  private pendingApproval = false

  private async send(label: string, req: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) {
    if (this.cfg.dryRun && this.pendingApproval) {
      return { label, dryRun: true as const, simulated: false, note: 'Needs the USDG approval above first, so it was not simulated.' }
    }
    const { request } = await this.pub
      .simulateContract({ ...(req as object), abi: [...req.abi, ...ERC20_ERRORS], account: this.account! } as never)
      .catch(explain)
    if (this.cfg.dryRun) {
      if (req.functionName === 'approve') this.pendingApproval = true
      return { label, dryRun: true as const, simulated: true }
    }
    const hash = await this.wallet!.writeContract(request as never)
    const r = await this.pub.waitForTransactionReceipt({ hash })
    if (r.status !== 'success') throw new LarryError(`${label} reverted: ${EXPLORER}/tx/${hash}`)
    return { label, hash, explorer: `${EXPLORER}/tx/${hash}` }
  }

  private async approve(spender: Address, amount: bigint) {
    const t = await this.token()
    const allowance = await this.pub.readContract({ address: t.address, abi: erc20Abi, functionName: 'allowance', args: [this.account!.address, spender] })
    if (allowance >= amount) return null
    return this.send(`Approve ${t.symbol}`, { address: t.address, abi: erc20Abi, functionName: 'approve', args: [spender, amount] })
  }

  async buyOption(p: { symbol: string; type: 'call' | 'put'; strike: number; expiry: string | number; contracts: number }) {
    this.pendingApproval = false
    const q = await this.quoteOption(p)
    const maxCost = (q.raw.cost * OPTION_SLIPPAGE) / 100n
    this.guard('options', q.totalCost * 1.01)
    const txs = [await this.approve(this.cfg.options, maxCost)]
    txs.push(await this.send('Buy option', { address: this.cfg.options, abi: LarryOptionsAbi, functionName: 'buy', args: [q.raw.marketId, q.raw.isCall, q.raw.strike, q.raw.expiry, q.raw.amount, maxCost] }))
    if (!this.cfg.dryRun) this.recordSpend(q.totalCost)
    const { raw, ...quote } = q
    return { ...quote, transactions: txs.filter(Boolean), limits: this.limits() }
  }

  async openPerp(p: { symbol: string; side: 'long' | 'short'; collateral: number; leverage: number }) {
    this.pendingApproval = false
    const perps = this.perpsAddress()
    const a = findAsset(p.symbol)
    const t = await this.token()
    const m = await this.pub.readContract({ address: perps, abi: LarryPerpsAbi, functionName: 'markets', args: [BigInt(a.id)] })
    if (m[0] === zeroAddress || !m[10]) throw new LarryError(`${a.symbol} perps are not listed`)
    if (p.leverage < 1 || p.leverage > m[2]) throw new LarryError(`Leverage must be between 1 and ${m[2]} on ${a.symbol}`)
    this.guard('perps', p.collateral)
    const collateral = parseUnits(String(p.collateral), t.decimals)
    const lev = BigInt(Math.round(p.leverage * 100))
    // size = net * lev and fee = size * openFee, so size = c * lev / (1 + lev * fee)
    const size = (collateral * lev * 10_000n) / (100n * 10_000n + lev * BigInt(m[3]))
    const price = await this.pub.readContract({ address: perps, abi: LarryPerpsAbi, functionName: 'price', args: [BigInt(a.id)] })
    const acceptable = p.side === 'long' ? (price * (10_000n + PERP_SLIPPAGE_BPS)) / 10_000n : (price * (10_000n - PERP_SLIPPAGE_BPS)) / 10_000n
    const txs = [await this.approve(perps, collateral)]
    txs.push(await this.send(`Open ${p.side}`, { address: perps, abi: LarryPerpsAbi, functionName: 'openPosition', args: [BigInt(a.id), p.side === 'long', collateral, size, acceptable] }))
    if (!this.cfg.dryRun) this.recordSpend(p.collateral)
    return { symbol: a.symbol, side: p.side, collateral: p.collateral, leverage: p.leverage, size: num(size, t.decimals), entryPrice: num(price, 18), currency: t.symbol, transactions: txs.filter(Boolean), limits: this.limits() }
  }

  async closePerp(id: number) {
    const perps = this.perpsAddress()
    this.guard('perps', 0)
    const pos = await this.pub.readContract({ address: perps, abi: LarryPerpsAbi, functionName: 'getPosition', args: [BigInt(id)] })
    if (pos.owner.toLowerCase() !== this.account!.address.toLowerCase()) throw new LarryError(`Position ${id} does not belong to this wallet`)
    const price = await this.pub.readContract({ address: perps, abi: LarryPerpsAbi, functionName: 'price', args: [BigInt(pos.marketId)] })
    const acceptable = pos.isLong ? (price * (10_000n - PERP_SLIPPAGE_BPS)) / 10_000n : (price * (10_000n + PERP_SLIPPAGE_BPS)) / 10_000n
    return { id, transactions: [await this.send('Close position', { address: perps, abi: LarryPerpsAbi, functionName: 'closePosition', args: [BigInt(id), acceptable] })] }
  }

  /** Settles the option's expiry from the first Chainlink round after it if needed, then pays it out. */
  async claimOption(id: number, contract?: string) {
    this.guard('options', 0)
    const c = addr(contract) ?? this.cfg.options
    const o = await this.pub.readContract({ address: c, abi: LarryOptionsAbi, functionName: 'getOption', args: [BigInt(id)] })
    if (o.owner === zeroAddress) throw new LarryError(`Option ${id} not found on ${c}`)
    if (o.exercised) throw new LarryError(`Option ${id} was already claimed`)
    const txs = []
    const settled = await this.pub.readContract({ address: c, abi: LarryOptionsAbi, functionName: 'settlementPrice', args: [BigInt(o.marketId), o.expiry] })
    if (settled === 0n) {
      const [feed] = await this.pub.readContract({ address: c, abi: LarryOptionsAbi, functionName: 'markets', args: [BigInt(o.marketId)] })
      const [latest] = await this.pub.readContract({ address: feed, abi: aggregatorAbi, functionName: 'latestRoundData' })
      let round = latest
      for (let i = 0; i < 5000 && round > 1n; i++) {
        const [, , , updatedAt] = await this.pub.readContract({ address: feed, abi: aggregatorAbi, functionName: 'getRoundData', args: [round - 1n] })
        if (updatedAt < o.expiry) break
        round -= 1n
      }
      txs.push(await this.send('Settle expiry', { address: c, abi: LarryOptionsAbi, functionName: 'settle', args: [BigInt(o.marketId), o.expiry, round] }))
    }
    txs.push(await this.send('Claim', { address: c, abi: LarryOptionsAbi, functionName: 'exercise', args: [BigInt(id)] }))
    const t = await this.token()
    const payout = await this.pub.readContract({ address: c, abi: LarryOptionsAbi, functionName: 'payoutOf', args: [BigInt(id)] })
    return { id, payout: num(payout, t.decimals), currency: t.symbol, transactions: txs }
  }

  async vaultDeposit(amount: number) {
    this.pendingApproval = false
    this.guard('vault', amount)
    const t = await this.token()
    const pool = await this.pool()
    const v = parseUnits(String(amount), t.decimals)
    const txs = [await this.approve(pool, v)]
    txs.push(await this.send('Deposit', { address: pool, abi: LarryPoolAbi, functionName: 'deposit', args: [v, this.account!.address] }))
    if (!this.cfg.dryRun) this.recordSpend(amount)
    return { deposited: amount, currency: t.symbol, transactions: txs.filter(Boolean), limits: this.limits() }
  }

  async vaultWithdraw(amount: number | 'max') {
    this.guard('vault', 0)
    const t = await this.token()
    const pool = await this.pool()
    const me = this.account!.address
    const v = amount === 'max' ? await this.pub.readContract({ address: pool, abi: LarryPoolAbi, functionName: 'maxWithdraw', args: [me] }) : parseUnits(String(amount), t.decimals)
    if (v === 0n) throw new LarryError('Nothing to withdraw yet (locked or fully reserved).')
    return { withdrawn: num(v, t.decimals), currency: t.symbol, transactions: [await this.send('Withdraw', { address: pool, abi: LarryPoolAbi, functionName: 'withdraw', args: [v, me, me] })] }
  }
}

