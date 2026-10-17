#!/usr/bin/env node
// $LARRY buyback and burn bot. Every few seconds it buys a small amount of $LARRY and burns it.
//
// With BUYBACK_CONTRACT set (recommended) the ETH sits in the LarryBuyback contract: the bot only signs
// the trigger and pays gas, the contract swaps, checks the minimum output, enforces its own per buy and
// daily caps, and sends every $LARRY it bought to the dead address. Routing goes through the 0x API
// (BUYBACK_ROUTE=0x, finds the best pool on its own) or a Uniswap V2 or V3 style router.
// Without a contract the bot's own wallet swaps on a V2 or V3 router with the dead address as recipient.
// Every swap has a minimum output from a fresh quote, so a moved price can't make it overpay.
//
//   node buyback/larry-buyback.mjs run              start the loop (needs BUYBACK_PRIVATE_KEY)
//   node buyback/larry-buyback.mjs check            show the setup, balances and a quote, send nothing
//   node buyback/larry-buyback.mjs detect <txhash>  inspect someone's $LARRY buy to find the DEX it used
//
// Settings come from the environment (or a .env file next to this script). See buyback/README.md.
import fs from 'node:fs'
import path from 'node:path'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  defineChain,
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  http,
  isAddress,
  maxUint256,
  parseAbi,
  parseAbiItem,
  toEventSelector,
  parseEther,
  parseUnits,
  zeroAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// ------------------------------------------------------------ settings

const here = path.dirname(new URL(import.meta.url).pathname)
for (const f of [path.join(here, '.env'), path.join(process.cwd(), '.env')]) {
  if (!fs.existsSync(f)) continue
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const env = process.env
const addr = (v, name, fallback) => {
  if (!v) return fallback
  if (!isAddress(v.trim())) throw new Error(`${name} is not an address: ${v}`)
  return getAddress(v.trim())
}

export const DEAD = '0x000000000000000000000000000000000000dEaD'
const cfg = {
  rpc: env.BUYBACK_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  explorer: env.BUYBACK_EXPLORER || 'https://robinhoodchain.blockscout.com',
  key: env.BUYBACK_PRIVATE_KEY,
  larry: addr(env.LARRY_TOKEN, 'LARRY_TOKEN', '0x72587018a341d5B668C0479e73b2Ee1c8D06f4f4'),
  contract: addr(env.BUYBACK_CONTRACT, 'BUYBACK_CONTRACT'),
  dex: (env.BUYBACK_ROUTE || env.BUYBACK_DEX || (env.BUYBACK_CONTRACT ? 'v4' : 'v2')).toLowerCase(), // v4, 0x, v2 or v3
  zeroxKey: env.BUYBACK_0X_API_KEY,
  zeroxUrl: env.BUYBACK_0X_URL || 'https://api.0x.org',
  router: addr(env.BUYBACK_ROUTER, 'BUYBACK_ROUTER'),
  quoter: addr(env.BUYBACK_QUOTER, 'BUYBACK_QUOTER'), // v3 only, QuoterV2
  fee: Number(env.BUYBACK_V3_FEE || 3000), // v3 pool fee tier
  // What the bot spends: "eth" for native ETH, or a token address such as USDG.
  pay: (env.BUYBACK_PAY || 'eth').toLowerCase() === 'eth' ? 'eth' : addr(env.BUYBACK_PAY, 'BUYBACK_PAY'),
  // Optional token between the pay token and LARRY when there is no direct pool (v2 only), e.g. WETH.
  via: addr(env.BUYBACK_VIA, 'BUYBACK_VIA'),
  everySec: Math.max(2, Number(env.BUYBACK_EVERY_SECONDS || 10)),
  perBuy: env.BUYBACK_AMOUNT || '0.00001', // in the pay token's units
  // Each buy spends a random amount between perBuy x (1 - jitter) and perBuy x (1 + jitter).
  jitter: Math.min(0.9, Math.max(0, Number(env.BUYBACK_JITTER ?? 0.3))),
  maxPerDay: env.BUYBACK_MAX_PER_DAY || '0.01',
  slippageBps: BigInt(env.BUYBACK_SLIPPAGE_BPS || 300),
  minGas: env.BUYBACK_MIN_GAS_ETH || '0.0005', // stop before the wallet can't pay gas
  dryRun: env.BUYBACK_DRY_RUN === '1' || env.BUYBACK_DRY_RUN === 'true',
  stateFile: env.BUYBACK_STATE || path.join(here, '.buyback-state.json'),
}

const chain = defineChain({
  id: Number(env.BUYBACK_CHAIN_ID || 4663),
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpc] } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
})
const pub = createPublicClient({ chain, transport: http(cfg.rpc) })

const V2 = parseAbi([
  'function WETH() view returns (address)',
  'function factory() view returns (address)',
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
])
const V3_ROUTER = parseAbi([
  'function WETH9() view returns (address)',
  'struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }',
  'function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)',
])
const V3_QUOTER = parseAbi([
  'struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }',
  'function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
])

const BUYBACK = parseAbi([
  'function buyAndBurn(address target, bytes data, uint256 value, uint256 minOut)',
  'function buyAndBurnV4(uint256 value, uint256 minOut) returns (uint256 burned)',
  'function poolManager() view returns (address)',
  'function v4Pool() view returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)',
  'function leftToday() view returns (uint256)',
  'function maxPerBuy() view returns (uint256)',
  'function keeper() view returns (address)',
  'function paused() view returns (bool)',
  'function allowedTarget(address) view returns (bool)',
  'function totalBurned() view returns (uint256)',
  'function buys() view returns (uint256)',
  'event BoughtAndBurned(address indexed target, uint256 ethSpent, uint256 larryBurned)',
])
const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

const log = (...a) => console.log(new Date().toISOString().replace('T', ' ').slice(0, 19), ...a)

// ------------------------------------------------------------ helpers

let meta
async function loadMeta() {
  if (meta) return meta
  if (!['v4', '0x', 'v2', 'v3'].includes(cfg.dex)) throw new Error('BUYBACK_ROUTE must be v4, 0x, v2 or v3')
  if (cfg.dex === 'v4') {
    if (!cfg.contract) throw new Error('The v4 route needs BUYBACK_CONTRACT (the LarryBuyback contract).')
    const pm = await pub.readContract({ address: cfg.contract, abi: BUYBACK, functionName: 'poolManager' })
    if (pm === zeroAddress) throw new Error('The buyback contract has no Uniswap V4 pool yet: set it on the admin page (run "detect <txhash>" to get the values).')
  }
  if (cfg.dex === '0x') {
    if (!cfg.contract) throw new Error('The 0x route needs BUYBACK_CONTRACT (the LarryBuyback contract).')
    if (!cfg.zeroxKey) throw new Error('Set BUYBACK_0X_API_KEY (free at dashboard.0x.org).')
  }
  if (cfg.contract && cfg.pay !== 'eth') throw new Error('The LarryBuyback contract spends ETH: set BUYBACK_PAY=eth.')
  if (cfg.dex !== '0x' && cfg.dex !== 'v4' && !cfg.router) throw new Error('Set BUYBACK_ROUTER to the DEX router address, or use BUYBACK_ROUTE=0x with a contract.')
  if (cfg.dex === 'v3' && !cfg.quoter) throw new Error('Set BUYBACK_QUOTER (the DEX QuoterV2) for v3')
  const weth = cfg.dex === '0x' || cfg.dex === 'v4' ? NATIVE : await pub.readContract({ address: cfg.router, abi: cfg.dex === 'v2' ? V2 : V3_ROUTER, functionName: cfg.dex === 'v2' ? 'WETH' : 'WETH9' })
  const payToken = cfg.pay === 'eth' ? weth : cfg.pay
  const payDecimals = cfg.pay === 'eth' ? 18 : await pub.readContract({ address: payToken, abi: erc20Abi, functionName: 'decimals' })
  const paySymbol = cfg.pay === 'eth' ? 'ETH' : await pub.readContract({ address: payToken, abi: erc20Abi, functionName: 'symbol' })
  const larryDecimals = await pub.readContract({ address: cfg.larry, abi: erc20Abi, functionName: 'decimals' })
  const route = [payToken, ...(cfg.via ? [cfg.via] : []), cfg.larry]
  meta = { weth, payToken, payDecimals, paySymbol, larryDecimals, route }
  return meta
}

const toPay = (v) => parseUnits(String(v), meta.payDecimals)
const fmtPay = (v) => `${Number(formatUnits(v, meta.payDecimals)).toPrecision(4)} ${meta.paySymbol}`
const fmtLarry = (v) => `${Math.round(Number(formatUnits(v, meta.larryDecimals))).toLocaleString('en-US')} LARRY`

/** 0x quote with the buyback contract as taker: returns the call the contract makes. */
async function zeroxQuote(amountIn) {
  const q = new URLSearchParams({ chainId: String(chain.id), sellToken: NATIVE, buyToken: cfg.larry, sellAmount: amountIn.toString(), taker: cfg.contract, slippageBps: cfg.slippageBps.toString() })
  const res = await fetch(`${cfg.zeroxUrl}/swap/allowance-holder/quote?${q}`, { headers: { '0x-api-key': cfg.zeroxKey, '0x-version': 'v2' } })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`0x: ${j.message ?? j.name ?? res.status}${j.data?.details ? ` ${JSON.stringify(j.data.details)}` : ''}`)
  if (j.liquidityAvailable === false || !j.transaction) throw new Error('0x found no route for this amount')
  return { target: getAddress(j.transaction.to), data: j.transaction.data, value: BigInt(j.transaction.value ?? amountIn), out: BigInt(j.buyAmount), minOut: BigInt(j.minBuyAmount) }
}

/** Live V4 quote: simulate the buy itself with no minimum. */
async function v4Quote(amountIn, account) {
  const { result } = await pub.simulateContract({ account: account ?? (await pub.readContract({ address: cfg.contract, abi: BUYBACK, functionName: 'keeper' })), address: cfg.contract, abi: BUYBACK, functionName: 'buyAndBurnV4', args: [amountIn, 0n] })
  return result
}

async function quote(amountIn, account) {
  if (cfg.dex === 'v4') return v4Quote(amountIn, account)
  if (cfg.dex === '0x') return (await zeroxQuote(amountIn)).out
  if (cfg.dex === 'v2') {
    const amounts = await pub.readContract({ address: cfg.router, abi: V2, functionName: 'getAmountsOut', args: [amountIn, meta.route] })
    return amounts.at(-1)
  }
  const { result } = await pub.simulateContract({
    address: cfg.quoter,
    abi: V3_QUOTER,
    functionName: 'quoteExactInputSingle',
    args: [{ tokenIn: meta.payToken, tokenOut: cfg.larry, amountIn, fee: cfg.fee, sqrtPriceLimitX96: 0n }],
  })
  return result[0]
}

function swapRequest(account, amountIn, minOut, to = DEAD) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 120)
  if (cfg.dex === 'v2') {
    return cfg.pay === 'eth'
      ? { account, address: cfg.router, abi: V2, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens', args: [minOut, meta.route, to, deadline], value: amountIn }
      : { account, address: cfg.router, abi: V2, functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens', args: [amountIn, minOut, meta.route, to, deadline] }
  }
  const params = { tokenIn: meta.payToken, tokenOut: cfg.larry, fee: cfg.fee, recipient: to, deadline, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }
  return { account, address: cfg.router, abi: V3_ROUTER, functionName: 'exactInputSingle', args: [params], value: cfg.pay === 'eth' ? amountIn : 0n }
}

const today = () => new Date().toISOString().slice(0, 10)
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8'))
    return s.day === today() ? s : { day: today(), spent: '0', buys: 0, burned: '0', totalBuys: s.totalBuys ?? 0, totalBurned: s.totalBurned ?? '0' }
  } catch {
    return { day: today(), spent: '0', buys: 0, burned: '0', totalBuys: 0, totalBurned: '0' }
  }
}
const saveState = (s) => fs.writeFileSync(cfg.stateFile, JSON.stringify(s, null, 2))

// ------------------------------------------------------------ commands

async function check() {
  await loadMeta()
  const account = cfg.key ? privateKeyToAccount(cfg.key.startsWith('0x') ? cfg.key : `0x${cfg.key}`) : null
  console.log('Route      ', cfg.dex, cfg.dex === '0x' ? cfg.zeroxUrl : cfg.router, cfg.dex === 'v3' ? `fee ${cfg.fee} quoter ${cfg.quoter}` : '')
  if (cfg.contract) {
    const [held, left, perBuy, keeper, paused, burned, buys] = await Promise.all([
      pub.getBalance({ address: cfg.contract }),
      ...['leftToday', 'maxPerBuy', 'keeper', 'paused', 'totalBurned', 'buys'].map((f) => pub.readContract({ address: cfg.contract, abi: BUYBACK, functionName: f })),
    ])
    console.log('Contract   ', cfg.contract, `${formatEther(held)} ETH, ${formatEther(left)} ETH left today, max ${formatEther(perBuy)} a buy, keeper ${keeper}${paused ? ', PAUSED' : ''}`)
    console.log('Burned     ', `${fmtLarry(burned)} in ${buys} buys so far`)
    if (cfg.dex === 'v4') {
      const pm = await pub.readContract({ address: cfg.contract, abi: BUYBACK, functionName: 'poolManager' })
      const k = await pub.readContract({ address: cfg.contract, abi: BUYBACK, functionName: 'v4Pool' })
      console.log('V4 pool    ', `PoolManager ${pm}, fee ${k[2]}, tickSpacing ${k[3]}, hooks ${k[4]}`)
      return
    }
    const target = cfg.dex === '0x' ? (await zeroxQuote(toPay(cfg.perBuy))).target : cfg.router
    const ok = await pub.readContract({ address: cfg.contract, abi: BUYBACK, functionName: 'allowedTarget', args: [target] })
    console.log('Target     ', target, ok ? 'allowed' : 'NOT ALLOWED: the owner must call setTarget(target, true)')
  }
  if (cfg.dex !== '0x') console.log('Path       ', meta.route.join(' -> '))
  console.log('Spend      ', `${cfg.perBuy} ${meta.paySymbol} every ${cfg.everySec}s (±${cfg.jitter * 100}%), at most ${cfg.maxPerDay} ${meta.paySymbol} a day`)
  console.log('Burns to   ', DEAD)
  const q = await quote(toPay(cfg.perBuy))
  console.log('Quote      ', `${cfg.perBuy} ${meta.paySymbol} buys about ${fmtLarry(q)}`)
  const perDayBuys = Math.floor((86_400 / cfg.everySec))
  console.log('Per day    ', `up to ${perDayBuys.toLocaleString('en-US')} buys, until ${cfg.maxPerDay} ${meta.paySymbol} is spent`)
  if (account) {
    const eth = await pub.getBalance({ address: account.address })
    const pay = cfg.pay === 'eth' ? eth : await pub.readContract({ address: meta.payToken, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })
    console.log('Wallet     ', account.address, `${formatEther(eth)} ETH`, cfg.pay === 'eth' ? '' : fmtPay(pay))
  } else console.log('Wallet      none (set BUYBACK_PRIVATE_KEY to run)')
}

async function detect(hash) {
  const tx = await pub.getTransaction({ hash })
  const r = await pub.getTransactionReceipt({ hash })
  const V2_SWAP = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
  const V3_SWAP = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'
  const v4Swap = parseAbiItem('event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)')
  const v4Init = parseAbiItem('event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)')
  const V4_SWAP = toEventSelector(v4Swap)
  for (const l of r.logs.filter((x) => x.topics[0] === V4_SWAP)) {
    const id = l.topics[1]
    console.log('Uniswap V4 PoolManager:', l.address, 'pool id', id, '-> use BUYBACK_ROUTE=v4')
    const latest = await pub.getBlockNumber()
    const find = async (from, to) => {
      try {
        return await pub.getLogs({ address: l.address, event: v4Init, args: { id }, fromBlock: from, toBlock: to })
      } catch (e) {
        if (to - from < 10_000n) throw e
        const mid = from + (to - from) / 2n
        const a = await find(from, mid)
        return a.length ? a : find(mid + 1n, to)
      }
    }
    const [init] = await find(0n, latest)
    if (!init) {
      console.log('  could not find the pool Initialize event; read the pool key from the explorer instead')
      continue
    }
    const k = init.args
    console.log(`  currency0 ${k.currency0}${k.currency0 === zeroAddress ? ' (ETH)' : ''}`)
    console.log(`  currency1 ${k.currency1}`)
    console.log(`  fee ${k.fee}, tickSpacing ${k.tickSpacing}, hooks ${k.hooks}`)
    console.log('Enter these on the admin page under "Uniswap V4 pool": PoolManager, fee, tick spacing and hooks.')
  }
  console.log('Sent to (router or aggregator):', tx.to)
  for (const l of r.logs) {
    if (l.topics[0] === V2_SWAP) console.log('Uniswap V2 style pool:', l.address, '-> use BUYBACK_DEX=v2')
    if (l.topics[0] === V3_SWAP) console.log('Uniswap V3 style pool:', l.address, '-> use BUYBACK_DEX=v3')
  }
  for (const l of r.logs.filter((x) => x.topics[0] === V2_SWAP || x.topics[0] === V3_SWAP)) {
    const p = parseAbi(['function factory() view returns (address)', 'function token0() view returns (address)', 'function token1() view returns (address)', 'function fee() view returns (uint24)'])
    const [factory, t0, t1] = await Promise.all(['factory', 'token0', 'token1'].map((f) => pub.readContract({ address: l.address, abi: p, functionName: f }).catch(() => null)))
    const fee = await pub.readContract({ address: l.address, abi: p, functionName: 'fee' }).catch(() => null)
    console.log(`  pool ${l.address}: factory ${factory}, tokens ${t0} / ${t1}${fee ? `, fee ${fee}` : ''}`)
  }
  console.log('Find the DEX router for that factory in the DEX docs and set BUYBACK_ROUTER.')
}

async function run() {
  if (!cfg.key) throw new Error('Set BUYBACK_PRIVATE_KEY to a wallet that holds only the buyback budget and gas.')
  await loadMeta()
  const account = privateKeyToAccount(cfg.key.startsWith('0x') ? cfg.key : `0x${cfg.key}`)
  const wallet = createWalletClient({ account, chain, transport: http(cfg.rpc) })
  // With a contract its own daily cap is the one that counts.
  const maxDay = cfg.contract ? maxUint256 / 2n : toPay(cfg.maxPerDay)
  const base = toPay(cfg.perBuy)
  const minGas = parseEther(cfg.minGas)
  log(`buyback wallet ${account.address}, ${cfg.perBuy} ${meta.paySymbol} every ${cfg.everySec}s, max ${cfg.maxPerDay} ${meta.paySymbol} a day${cfg.dryRun ? ', DRY RUN' : ''}`)

  if (cfg.pay !== 'eth' && !cfg.dryRun) {
    const allowance = await pub.readContract({ address: meta.payToken, abi: erc20Abi, functionName: 'allowance', args: [account.address, cfg.router] })
    if (allowance < maxDay) {
      const hash = await wallet.writeContract({ address: meta.payToken, abi: erc20Abi, functionName: 'approve', args: [cfg.router, maxUint256] })
      await pub.waitForTransactionReceipt({ hash })
      log(`approved ${meta.paySymbol} for the router`)
    }
  }

  if (cfg.contract) {
    const [keeper, paused] = await Promise.all(['keeper', 'paused'].map((f) => pub.readContract({ address: cfg.contract, abi: BUYBACK, functionName: f })))
    if (keeper.toLowerCase() !== account.address.toLowerCase()) log(`warning: the contract's keeper is ${keeper}, not this wallet; buys will revert unless this wallet is the owner`)
    if (paused) log('warning: the buyback contract is paused')
    log(`buying through LarryBuyback ${cfg.contract} via ${cfg.dex}`)
  }

  let stop = false
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => ((stop = true), log('stopping after this buy')))
  const maxRuns = Number(env.BUYBACK_MAX_RUNS || 0) // for tests

  for (let n = 1; !stop; n++) {
    const started = Date.now()
    const s = loadState()
    try {
      const spent = BigInt(s.spent)
      const r = 1 - cfg.jitter + Math.random() * 2 * cfg.jitter
      let amountIn = (base * BigInt(Math.round(r * 1e6))) / 1_000_000n
      if (spent + amountIn > maxDay) amountIn = maxDay - spent
      const eth = await pub.getBalance({ address: account.address, blockTag: 'latest' })
      if (cfg.contract && amountIn > 0n) {
        const [left, perBuy, held] = await Promise.all([
          pub.readContract({ address: cfg.contract, abi: BUYBACK, functionName: 'leftToday' }),
          pub.readContract({ address: cfg.contract, abi: BUYBACK, functionName: 'maxPerBuy' }),
          pub.getBalance({ address: cfg.contract }),
        ])
        for (const cap of [left, perBuy, held]) if (amountIn > cap) amountIn = cap
        if (amountIn <= 0n) {
          log(held === 0n ? 'the buyback contract has no ETH left, send ETH to it' : "the contract's daily limit is used, waiting for tomorrow (UTC)")
          throw null
        }
        if (eth < minGas) {
          log(`low ETH for gas (${formatEther(eth)}), top up the keeper wallet`)
          throw null
        }
        await contractBuy(account, wallet, amountIn, s, spent)
      } else if (amountIn <= 0n) log(`daily budget of ${cfg.maxPerDay} ${meta.paySymbol} used, waiting for tomorrow (UTC)`)
      else if (eth < minGas + (cfg.pay === 'eth' ? amountIn : 0n)) log(`low ETH (${formatEther(eth)}), top up the buyback wallet`)
      else {
        const out = await quote(amountIn)
        const minOut = (out * (10_000n - cfg.slippageBps)) / 10_000n
        const req = swapRequest(account, amountIn, minOut)
        const { request } = await pub.simulateContract(req)
        if (cfg.dryRun) log(`dry run: ${fmtPay(amountIn)} would buy and burn about ${fmtLarry(out)}`)
        else {
          const before = await pub.readContract({ address: cfg.larry, abi: erc20Abi, functionName: 'balanceOf', args: [DEAD] })
          const hash = await wallet.writeContract(request)
          const rcpt = await pub.waitForTransactionReceipt({ hash })
          if (rcpt.status !== 'success') throw new Error(`swap reverted ${hash}`)
          const after = await pub.readContract({ address: cfg.larry, abi: erc20Abi, functionName: 'balanceOf', args: [DEAD], blockNumber: rcpt.blockNumber })
          const burned = after - before > 0n ? after - before : out
          s.spent = (spent + amountIn).toString()
          s.buys += 1
          s.burned = (BigInt(s.burned) + burned).toString()
          s.totalBuys += 1
          s.totalBurned = (BigInt(s.totalBurned) + burned).toString()
          saveState(s)
          log(`🔥 bought and burned ${fmtLarry(burned)} for ${fmtPay(amountIn)}  ${cfg.explorer}/tx/${hash}`)
        }
      }
    } catch (e) {
      if (e) log('buy skipped:', e.shortMessage ?? e.message)
    }
    if (maxRuns && n >= maxRuns) break
    const wait = cfg.everySec * 1000 - (Date.now() - started)
    if (wait > 0 && !stop) await new Promise((res) => setTimeout(res, wait))
  }
}

/** One buy through the LarryBuyback contract: it swaps its own ETH and burns everything it receives. */
async function contractBuy(account, wallet, amountIn, s, spent) {
  if (cfg.dex === 'v4') {
    const out = await v4Quote(amountIn, account)
    const minOut = (out * (10_000n - cfg.slippageBps)) / 10_000n
    const { request } = await pub.simulateContract({ account, address: cfg.contract, abi: BUYBACK, functionName: 'buyAndBurnV4', args: [amountIn, minOut] })
    if (cfg.dryRun) return log(`dry run: ${fmtPay(amountIn)} would buy and burn about ${fmtLarry(out)}`)
    return sendAndRecord(wallet, request, out, amountIn, s, spent)
  }
  let target, data, value, out, minOut
  if (cfg.dex === '0x') ({ target, data, value, out, minOut } = await zeroxQuote(amountIn))
  else {
    out = await quote(amountIn)
    minOut = (out * (10_000n - cfg.slippageBps)) / 10_000n
    const req = swapRequest(account, amountIn, minOut, cfg.contract)
    target = req.address
    data = encodeFunctionData({ abi: req.abi, functionName: req.functionName, args: req.args })
    value = amountIn
  }
  const allowed = await pub.readContract({ address: cfg.contract, abi: BUYBACK, functionName: 'allowedTarget', args: [target] })
  if (!allowed) throw new Error(`${target} is not an allowed target on the buyback contract; the owner must allow it (setTarget)`)
  const { request } = await pub.simulateContract({ account, address: cfg.contract, abi: BUYBACK, functionName: 'buyAndBurn', args: [target, data, value, minOut] })
  if (cfg.dryRun) return log(`dry run: ${fmtPay(value)} would buy and burn about ${fmtLarry(out)}`)
  return sendAndRecord(wallet, request, out, value, s, spent)
}

async function sendAndRecord(wallet, request, out, value, s, spent) {
  const hash = await wallet.writeContract(request)
  const rcpt = await pub.waitForTransactionReceipt({ hash })
  if (rcpt.status !== 'success') throw new Error(`buy reverted ${hash}`)
  let burned = out
  let ethSpent = value
  for (const l of rcpt.logs) {
    if (l.address.toLowerCase() !== cfg.contract.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: BUYBACK, data: l.data, topics: l.topics })
      if (ev.eventName === 'BoughtAndBurned') ({ larryBurned: burned, ethSpent } = ev.args)
    } catch {}
  }
  s.spent = (spent + ethSpent).toString()
  s.buys += 1
  s.burned = (BigInt(s.burned) + burned).toString()
  s.totalBuys += 1
  s.totalBurned = (BigInt(s.totalBurned) + burned).toString()
  saveState(s)
  log(`🔥 bought and burned ${fmtLarry(burned)} for ${fmtPay(ethSpent)}  ${cfg.explorer}/tx/${hash}`)
}

const [cmd, arg] = process.argv.slice(2)
const main = { run, check, detect: () => detect(arg) }[cmd ?? 'check']
if (!main) {
  console.log('usage: larry-buyback.mjs run | check | detect <txhash>')
  process.exit(1)
}
main().catch((e) => {
  console.error(e.shortMessage ?? e.message)
  process.exit(1)
})
