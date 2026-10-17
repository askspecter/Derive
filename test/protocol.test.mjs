// End to end tests for the Larry contracts against a local Hardhat node (chain id 4663).
// Run: npx hardhat node  (in another terminal), then: npm run test:contracts
import { test, before, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getContractAddress,
  http,
  parseUnits,
  formatUnits,
  maxUint256,
  defineChain,
  keccak256,
  toHex,
} from 'viem'

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const chain = defineChain({
  id: 4663,
  name: 'Local Robinhood',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})
const pub = createPublicClient({ chain, transport: http(RPC) })
const testClient = createTestClient({ chain, mode: 'hardhat', transport: http(RPC) })
const app = JSON.parse(fs.readFileSync(new URL('../src/contracts/artifacts.json', import.meta.url)))
const mocks = JSON.parse(fs.readFileSync(new URL('./artifacts/mocks.json', import.meta.url)))

const keccakName = (s) => keccak256(toHex(s))
const usd = (v) => parseUnits(String(v), 6)
const wad = (v) => parseUnits(String(v), 18)
const feedPx = (v) => parseUnits(String(v), 8)
const WEEK = 604800n
const FRIDAY_0800 = 115200n

let admin, alice, bob, lp, keeper, treasury
let usdg, ethFeed, pool, perps, options
let snap

const w = (account) => createWalletClient({ account, chain, transport: http(RPC) })

async function send(account, address, abi, functionName, args = []) {
  const hash = await w(account).writeContract({ address, abi, functionName, args })
  const r = await pub.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') throw new Error(`${functionName} reverted`)
  return r
}
const read = (address, abi, functionName, args = []) => pub.readContract({ address, abi, functionName, args })
async function deploy(account, art, args = []) {
  const hash = await w(account).deployContract({ abi: art.abi, bytecode: art.bytecode, args })
  const r = await pub.waitForTransactionReceipt({ hash })
  return r.contractAddress
}
async function reverts(promise, name) {
  await assert.rejects(promise, (e) => {
    const msg = String(e?.shortMessage ?? '') + String(e?.message ?? '')
    if (name && !msg.includes(name)) throw new Error(`expected ${name}, got: ${msg.slice(0, 300)}`)
    return true
  })
}
const now = async () => (await pub.getBlock()).timestamp
const warp = async (s) => {
  await testClient.increaseTime({ seconds: Number(s) })
  await testClient.mine({ blocks: 1 })
}
const bal = (who) => read(usdg, mocks.MockERC20.abi, 'balanceOf', [who])
const P = (fn, args) => read(pool, app.LarryPool.abi, fn, args)

const ETH_MARKET = 0n
const perpMarket = (feed) => ({
  feed,
  heartbeat: 3600,
  maxLeverage: 20,
  openFeeBps: 10,
  closeFeeBps: 10,
  borrowBpsPerDay: 5,
  maintenanceBps: 100,
  liquidationFeeBps: 50,
  maxProfitMultiple: 9,
  maxOpenInterest: usd(1_000_000),
  enabled: true,
})
const optMarket = (feed) => ({
  feed,
  heartbeat: 3600,
  vol: wad(0.6),
  spreadBps: 300,
  minPremiumBps: 5,
  maxExpiry: 92 * 86400,
  maxOpenNotional: usd(2_000_000),
  enabled: true,
})

before(async () => {
  await testClient.request({ method: 'hardhat_reset', params: [] }) // fresh chain every run
  ;[admin, alice, bob, lp, keeper, treasury] = await pub.request({ method: 'eth_accounts' })
  // Infrastructure that already exists on Robinhood Chain (USDG, Chainlink) is mocked here,
  // deployed by another account so the admin keeps nonce 0 like a fresh deployer wallet.
  usdg = await deploy(keeper, mocks.MockERC20, ['Global Dollar', 'USDG', 6])
  ethFeed = await deploy(keeper, mocks.MockAggregator, [8, 'ETH / USD', feedPx(3000)])

  // Same deterministic addressing the admin page uses: a fresh admin wallet deploys at nonce 0, 1, 2.
  assert.equal(await pub.getTransactionCount({ address: admin }), 0)
  const expected = [0n, 1n, 2n].map((nonce) => getContractAddress({ from: admin, nonce }))
  pool = await deploy(admin, app.LarryPool, [usdg, usd(1_000_000)])
  perps = await deploy(admin, app.LarryPerps, [expected[0]])
  options = await deploy(admin, app.LarryOptions, [expected[0]])
  assert.deepEqual([pool, perps, options].map((a) => a.toLowerCase()), expected.map((a) => a.toLowerCase()))

  await send(admin, pool, app.LarryPool.abi, 'setProduct', [perps, true])
  await send(admin, pool, app.LarryPool.abi, 'setProduct', [options, true])
  await send(admin, pool, app.LarryPool.abi, 'setTreasury', [treasury])
  await send(admin, perps, app.LarryPerps.abi, 'setMarket', [ETH_MARKET, perpMarket(ethFeed)])
  await send(admin, options, app.LarryOptions.abi, 'setMarket', [ETH_MARKET, optMarket(ethFeed)])

  for (const who of [alice, bob, lp]) {
    await send(keeper, usdg, mocks.MockERC20.abi, 'mint', [who, usd(1_000_000)])
    for (const spender of [pool, perps, options]) await send(who, usdg, mocks.MockERC20.abi, 'approve', [spender, maxUint256])
  }
  await send(lp, pool, app.LarryPool.abi, 'deposit', [usd(500_000), lp])
})

beforeEach(async () => {
  snap = await testClient.snapshot()
})
afterEach(async () => {
  await testClient.revert({ id: snap })
})

async function setEth(price) {
  await send(keeper, ethFeed, mocks.MockAggregator.abi, 'setAnswer', [feedPx(price)])
}
async function assertSolvent() {
  const reserved = await P('totalReserved')
  const assets = await P('totalAssets')
  assert.ok(assets >= reserved, `pool insolvent: assets ${assets} < reserved ${reserved}`)
}

// ------------------------------------------------------------------ pool

test('pool: LP deposit respects cap, lock and reserved liquidity', async () => {
  assert.equal(await P('totalAssets'), usd(500_000))
  await reverts(send(alice, pool, app.LarryPool.abi, 'deposit', [usd(600_000), alice]), 'ERC4626ExceededMaxDeposit')

  await send(alice, pool, app.LarryPool.abi, 'deposit', [usd(10_000), alice])
  await reverts(send(alice, pool, app.LarryPool.abi, 'withdraw', [usd(1), alice, alice]), 'ERC4626ExceededMaxWithdraw')
  const shares = await P('balanceOf', [alice])
  await reverts(send(alice, pool, app.LarryPool.abi, 'transfer', [bob, shares]), 'Locked')

  await warp(86401)
  await send(alice, pool, app.LarryPool.abi, 'redeem', [shares, alice, alice])
  assert.ok((await bal(alice)) >= usd(1_000_000) - 1n)

  await send(admin, pool, app.LarryPool.abi, 'setDepositsPaused', [true])
  await reverts(send(alice, pool, app.LarryPool.abi, 'deposit', [usd(1), alice]))
})

test('pool: only products can reserve, only owner can configure', async () => {
  await reverts(send(alice, pool, app.LarryPool.abi, 'reserve', [1n]), 'NotProduct')
  await reverts(send(alice, pool, app.LarryPool.abi, 'payOut', [alice, 1n]), 'NotProduct')
  await reverts(send(alice, pool, app.LarryPool.abi, 'setProduct', [alice, true]), 'OwnableUnauthorizedAccount')
  await reverts(send(alice, perps, app.LarryPerps.abi, 'setPaused', [true]), 'OwnableUnauthorizedAccount')
  await reverts(send(alice, options, app.LarryOptions.abi, 'setVol', [0n, wad(1)]), 'OwnableUnauthorizedAccount')
})

// ----------------------------------------------------------------- perps

const posIdsOf = (who) => read(perps, app.LarryPerps.abi, 'positionIdsOf', [who])

test('perps: long wins, trader paid by pool, fees split, reservation released', async () => {
  const before = await bal(alice)
  const poolBefore = await P('totalAssets')
  // 1000 collateral, 5000 size (5x)
  await send(alice, perps, app.LarryPerps.abi, 'openPosition', [ETH_MARKET, true, usd(1000), usd(5000), wad(3010)])
  const [id] = await posIdsOf(alice)
  const pos = await read(perps, app.LarryPerps.abi, 'getPosition', [id])
  const openFee = usd(5) // 10 bps of 5000
  assert.equal(pos.collateral, usd(1000) - openFee)
  assert.equal(pos.reserved, (usd(1000) - openFee) * 9n)
  assert.equal(await bal(treasury), (openFee * 3000n) / 10000n)
  assert.equal(await P('totalReserved'), pos.reserved)

  await setEth(3300) // +10% => pnl +500
  await send(alice, perps, app.LarryPerps.abi, 'closePosition', [id, wad(3290)])
  const closeFee = usd(5)
  const after = await bal(alice)
  // received = collateral(995) + 500 - closeFee(5) - small borrow fee
  const received = after - (before - usd(1000))
  assert.ok(received <= usd(1490) && received > usd(1489.9), `received ${formatUnits(received, 6)}`)
  assert.equal(await P('totalReserved'), 0n)
  assert.equal((await posIdsOf(alice)).length, 0)
  // pool lost the trader's profit net of fees it kept
  const poolAfter = await P('totalAssets')
  assert.ok(poolAfter < poolBefore && poolBefore - poolAfter < usd(500))
  await assertSolvent()
})

test('perps: short loses, loss and fees flow to the pool', async () => {
  const poolBefore = await P('totalAssets')
  await send(alice, perps, app.LarryPerps.abi, 'openPosition', [ETH_MARKET, false, usd(1000), usd(4000), wad(2990)])
  const [id] = await posIdsOf(alice)
  await warp(86400 * 2) // two days of borrow fee
  await setEth(3150) // +5% => short pnl -200
  const before = await bal(alice)
  await send(alice, perps, app.LarryPerps.abi, 'closePosition', [id, wad(3160)])
  const received = (await bal(alice)) - before
  // 996 - 200 - 4 (close fee) - borrow (4000 * 5bps * 2 = 4)
  assert.ok(received > usd(787.9) && received < usd(788.1), `received ${formatUnits(received, 6)}`)
  const poolAfter = await P('totalAssets')
  assert.ok(poolAfter - poolBefore > usd(200), 'pool gains the loss plus fees')
  await assertSolvent()
})

test('perps: profit is capped at the reservation', async () => {
  await send(alice, perps, app.LarryPerps.abi, 'openPosition', [ETH_MARKET, true, usd(1000), usd(19000), wad(3010)])
  const [id] = await posIdsOf(alice)
  const pos = await read(perps, app.LarryPerps.abi, 'getPosition', [id])
  await setEth(9000) // huge move: uncapped pnl would be 40000
  const before = await bal(alice)
  await send(alice, perps, app.LarryPerps.abi, 'closePosition', [id, 0n])
  const received = (await bal(alice)) - before
  assert.ok(received <= pos.collateral + pos.reserved)
  assert.equal(await P('totalReserved'), 0n)
  await assertSolvent()
})

test('perps: liquidation by a keeper', async () => {
  await send(alice, perps, app.LarryPerps.abi, 'openPosition', [ETH_MARKET, true, usd(1000), usd(10000), wad(3010)])
  const [id] = await posIdsOf(alice)
  await reverts(send(keeper, perps, app.LarryPerps.abi, 'liquidate', [id]), 'NotLiquidatable')
  const liqPx = await read(perps, app.LarryPerps.abi, 'liquidationPrice', [id])
  assert.ok(liqPx < wad(2800) && liqPx > wad(2700), `liq ${formatUnits(liqPx, 18)}`)

  await setEth(2720)
  const state = await read(perps, app.LarryPerps.abi, 'positionState', [id])
  assert.equal(state[4], true)
  const kBefore = await bal(keeper)
  await send(keeper, perps, app.LarryPerps.abi, 'liquidate', [id])
  assert.equal((await bal(keeper)) - kBefore, usd(50)) // 50 bps of 10000
  assert.equal(await read(perps, app.LarryPerps.abi, 'openPositionCount'), 0n)
  assert.equal(await P('totalReserved'), 0n)
  await assertSolvent()
})

test('perps: guards for slippage, leverage, stale price, caps, pause', async () => {
  const open = (c, s, px, who = alice) => send(who, perps, app.LarryPerps.abi, 'openPosition', [ETH_MARKET, true, c, s, px])
  await reverts(open(usd(1000), usd(5000), wad(2990)), 'SlippageExceeded')
  await reverts(open(usd(1000), usd(30000), wad(3010)), 'BadLeverage')
  await reverts(open(usd(5), usd(10), wad(3010)), 'CollateralTooSmall')
  await reverts(open(usd(100000), usd(1500000), wad(3010)), 'OpenInterestCap')

  await send(admin, perps, app.LarryPerps.abi, 'setPaused', [true])
  await reverts(open(usd(1000), usd(5000), wad(3010)), 'Paused')
  await send(admin, perps, app.LarryPerps.abi, 'setPaused', [false])

  await send(alice, perps, app.LarryPerps.abi, 'openPosition', [ETH_MARKET, true, usd(1000), usd(5000), wad(3010)])
  const [id] = await posIdsOf(alice)
  await send(admin, perps, app.LarryPerps.abi, 'setPaused', [true])
  await warp(4000) // feed goes stale
  await reverts(send(alice, perps, app.LarryPerps.abi, 'closePosition', [id, 0n]), 'StalePrice')
  await setEth(3000)
  // closing still works while paused
  await send(alice, perps, app.LarryPerps.abi, 'closePosition', [id, 0n])
  await reverts(send(bob, perps, app.LarryPerps.abi, 'closePosition', [id, 0n]))
})

test('perps: pool cannot over reserve and LPs cannot pull reserved liquidity', async () => {
  // shrink the pool so reservations bind
  await warp(86401)
  const lpShares = await P('balanceOf', [lp])
  await send(lp, pool, app.LarryPool.abi, 'redeem', [lpShares - lpShares / 100n, lp, lp]) // leave ~5000
  await setEth(3000) // keep the feed fresh after the warp
  const free = await P('freeLiquidity')
  assert.ok(free < usd(5100))
  await reverts(
    send(alice, perps, app.LarryPerps.abi, 'openPosition', [ETH_MARKET, true, usd(1000), usd(5000), wad(3010)]),
    '0xdcec4050', // LarryPool.InsufficientFreeLiquidity(), raised inside the pool
  )
  await send(alice, perps, app.LarryPerps.abi, 'openPosition', [ETH_MARKET, true, usd(500), usd(2000), wad(3010)])
  const maxW = await P('maxWithdraw', [lp])
  assert.ok(maxW <= (await P('freeLiquidity')))
  await assertSolvent()
})

// --------------------------------------------------------------- options

function normCdf(x) {
  const z = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * z)
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-z * z)
  return 0.5 * (1 + (x >= 0 ? erf : -erf))
}
function bs(isCall, S, K, T, v) {
  const d1 = (Math.log(S / K) + 0.5 * v * v * T) / (v * Math.sqrt(T))
  const d2 = d1 - v * Math.sqrt(T)
  return isCall ? S * normCdf(d1) - K * normCdf(d2) : K * normCdf(-d2) - S * normCdf(-d1)
}
async function nextExpiry(weeks = 1n) {
  const t = await now()
  let e = t - ((t - FRIDAY_0800) % WEEK) + WEEK * weeks
  if (e <= t + 3600n) e += WEEK
  return e
}
const optIdsOf = (who) => read(options, app.LarryOptions.abi, 'optionIdsOf', [who])

test('options: onchain Black Scholes matches the reference model', async () => {
  const expiry = await nextExpiry(2n)
  const T = Number(expiry - (await now())) / (365 * 86400)
  for (const [isCall, K] of [[true, 3000], [true, 3300], [false, 2700], [false, 3000], [true, 2500]]) {
    const [premium] = await read(options, app.LarryOptions.abi, 'quote', [ETH_MARKET, isCall, wad(K), expiry, wad(1)])
    const model = Math.max(bs(isCall, 3000, K, T, 0.6) * 1.03, 3000 * 0.0005)
    const got = Number(formatUnits(premium, 6))
    assert.ok(Math.abs(got - model) / model < 0.002, `${isCall ? 'C' : 'P'}${K}: chain ${got} vs model ${model.toFixed(4)}`)
  }
})

test('options: buy, settle from the first round after expiry, exercise in the money', async () => {
  const expiry = await nextExpiry()
  const [premium, fee, maxPayout] = await read(options, app.LarryOptions.abi, 'quote', [ETH_MARKET, true, wad(3000), expiry, wad(2)])
  const poolBefore = await P('totalAssets')
  await reverts(send(alice, options, app.LarryOptions.abi, 'buy', [ETH_MARKET, true, wad(3000), expiry, wad(2), premium]), 'PremiumTooHigh')
  await send(alice, options, app.LarryOptions.abi, 'buy', [ETH_MARKET, true, wad(3000), expiry, wad(2), premium + fee])
  const [id] = await optIdsOf(alice)
  // the premium is re-quoted in the buy block, a second later, so it can be a hair lower
  const paid = (await read(options, app.LarryOptions.abi, 'getOption', [id])).premium
  assert.ok(paid <= premium && premium - paid < usd(0.01))
  assert.equal((await P('totalAssets')) - poolBefore, paid)
  assert.equal(await bal(treasury), (paid * 30n) / 10000n)
  assert.equal(await P('totalReserved'), maxPayout)
  assert.equal(maxPayout, usd(6000))

  await reverts(send(bob, options, app.LarryOptions.abi, 'settle', [ETH_MARKET, expiry, 1n]), 'NotExpired')

  // rounds: one before expiry, then the settlement round, then a later one
  const t0 = await now()
  await warp(expiry - t0 - 600n)
  await setEth(3150) // before expiry
  await warp(1200n)
  const roundBefore = await read(ethFeed, mocks.MockAggregator.abi, 'latestRound')
  await setEth(3400) // first round after expiry
  const settleRound = roundBefore + 1n
  await warp(600n)
  await setEth(3600) // later round

  await reverts(send(bob, options, app.LarryOptions.abi, 'settle', [ETH_MARKET, expiry, roundBefore]), 'BadRound')
  await reverts(send(bob, options, app.LarryOptions.abi, 'settle', [ETH_MARKET, expiry, settleRound + 1n]), 'BadRound')
  await send(bob, options, app.LarryOptions.abi, 'settle', [ETH_MARKET, expiry, settleRound])
  assert.equal(await read(options, app.LarryOptions.abi, 'settlementPrice', [ETH_MARKET, expiry]), wad(3400))
  await reverts(send(bob, options, app.LarryOptions.abi, 'settle', [ETH_MARKET, expiry, settleRound]), 'AlreadySettled')

  const before = await bal(alice)
  await send(bob, options, app.LarryOptions.abi, 'exercise', [id]) // anyone can trigger, owner gets paid
  assert.equal((await bal(alice)) - before, usd(800)) // (3400 - 3000) * 2
  assert.equal(await P('totalReserved'), 0n)
  await reverts(send(bob, options, app.LarryOptions.abi, 'exercise', [id]), 'AlreadyExercised')
  await assertSolvent()
})

test('options: out of the money expires worthless, puts pay, payout capped at strike', async () => {
  const expiry = await nextExpiry()
  const buy = async (isCall, K, amt) => {
    const [p, f] = await read(options, app.LarryOptions.abi, 'quote', [ETH_MARKET, isCall, wad(K), expiry, wad(amt)])
    await send(alice, options, app.LarryOptions.abi, 'buy', [ETH_MARKET, isCall, wad(K), expiry, wad(amt), p + f])
  }
  await buy(true, 3500, 1) // OTM call
  await buy(false, 3200, 1) // ITM put
  await buy(true, 1600, 1) // deep ITM call, capped at strike
  const ids = await optIdsOf(alice)

  const t0 = await now()
  await warp(expiry - t0 + 10n)
  const r = (await read(ethFeed, mocks.MockAggregator.abi, 'latestRound')) + 1n
  await setEth(3100)
  await send(bob, options, app.LarryOptions.abi, 'settle', [ETH_MARKET, expiry, r])

  const payouts = await Promise.all(ids.map((id) => read(options, app.LarryOptions.abi, 'payoutOf', [id])))
  assert.deepEqual(payouts, [0n, usd(100), usd(1500)])
  for (const id of ids) await send(bob, options, app.LarryOptions.abi, 'exercise', [id])
  assert.equal(await P('totalReserved'), 0n)
  await assertSolvent()
})

test('options: guards for expiry, strike, caps, pause and manual settle delay', async () => {
  const q = (K, e) => read(options, app.LarryOptions.abi, 'quote', [ETH_MARKET, true, wad(K), e, wad(1)])
  const expiry = await nextExpiry()
  await reverts(q(3000, expiry + 3600n), 'BadExpiry') // not a Friday 08:00
  await reverts(q(3000, expiry + WEEK * 20n), 'BadExpiry') // beyond max expiry
  await reverts(q(7000, expiry), 'BadStrike')
  await send(admin, options, app.LarryOptions.abi, 'setPaused', [true])
  const [p, f] = await q(3000, expiry)
  await reverts(send(alice, options, app.LarryOptions.abi, 'buy', [ETH_MARKET, true, wad(3000), expiry, wad(1), p + f]), 'Paused')
  await send(admin, options, app.LarryOptions.abi, 'setPaused', [false])
  await reverts(
    send(alice, options, app.LarryOptions.abi, 'buy', [ETH_MARKET, true, wad(3000), expiry, wad(800), maxUint256]),
    'NotionalCap',
  )
  const t0 = await now()
  await warp(expiry - t0 + 10n)
  await reverts(send(admin, options, app.LarryOptions.abi, 'settleManual', [ETH_MARKET, expiry, wad(3000)]), 'NotExpired')
  await warp(3n * 86400n)
  await reverts(send(alice, options, app.LarryOptions.abi, 'settleManual', [ETH_MARKET, expiry, wad(3000)]), 'OwnableUnauthorizedAccount')
  await send(admin, options, app.LarryOptions.abi, 'settleManual', [ETH_MARKET, expiry, wad(3000)])
})

test('options: daily 0DTE expiries only on opted in markets, with the short dated spread', async () => {
  const DAY = 86400n
  const t = await now()
  // next 08:00 UTC more than an hour away that is not a Friday
  let e = t - ((t - 28800n) % DAY) + DAY
  if (e <= t + 3600n) e += DAY
  if (e % WEEK === FRIDAY_0800) e += DAY
  // move to six hours before that expiry, with a fresh oracle price
  if (e - t > 6n * 3600n) await warp(e - t - 6n * 3600n)
  await setEth(3000)
  const q = (K) => read(options, app.LarryOptions.abi, 'quote', [ETH_MARKET, true, wad(K), e, wad(1)])
  await reverts(q(3000), 'BadExpiry')
  assert.equal(await read(options, app.LarryOptions.abi, 'isValidExpiryFor', [ETH_MARKET, e]), false)

  await reverts(send(alice, options, app.LarryOptions.abi, 'setDailyExpiries', [[ETH_MARKET], true]), 'OwnableUnauthorizedAccount')
  await reverts(send(admin, options, app.LarryOptions.abi, 'setDailyExpiries', [[ETH_MARKET, 9n], true]), 'BadParams') // 9 is not listed
  await send(admin, options, app.LarryOptions.abi, 'setDailyExpiries', [[ETH_MARKET], true])
  assert.equal(await read(options, app.LarryOptions.abi, 'isValidExpiryFor', [ETH_MARKET, e]), true)
  // not 08:00 is still rejected
  await reverts(read(options, app.LarryOptions.abi, 'quote', [ETH_MARKET, true, wad(3000), e + 3600n, wad(1)]), 'BadExpiry')

  // under a day to expiry: market spread plus the short dated spread (3% + 3%)
  const T = Number(e - (await now())) / (365 * 86400)
  assert.ok(T * 365 < 1)
  const [premium] = await q(3000)
  const model = Math.max(bs(true, 3000, 3000, T, 0.6) * 1.06, 3000 * 0.0005)
  const got = Number(formatUnits(premium, 6))
  assert.ok(Math.abs(got - model) / model < 0.003, `chain ${got} vs model ${model.toFixed(4)}`)
  await reverts(send(admin, options, app.LarryOptions.abi, 'setShortDatedSpreadBps', [2001n]), 'BadParams')
  await send(admin, options, app.LarryOptions.abi, 'setShortDatedSpreadBps', [500n])
  assert.equal(await read(options, app.LarryOptions.abi, 'shortDatedSpreadBps'), 500n)

  // buy, settle at the daily expiry, exercise
  const [p, f, maxPayout] = await q(3000)
  await send(alice, options, app.LarryOptions.abi, 'buy', [ETH_MARKET, true, wad(3000), e, wad(1), p + f])
  assert.equal(await P('totalReserved'), maxPayout)
  const [id] = await optIdsOf(alice)
  const t0 = await now()
  await warp(e - t0 + 5n)
  const r = (await read(ethFeed, mocks.MockAggregator.abi, 'latestRound')) + 1n
  await setEth(3120)
  await send(bob, options, app.LarryOptions.abi, 'settle', [ETH_MARKET, e, r])
  const before = await bal(alice)
  await send(bob, options, app.LarryOptions.abi, 'exercise', [id])
  assert.equal((await bal(alice)) - before, usd(120))
  assert.equal(await P('totalReserved'), 0n)

  // turning dailies off stops new daily buys, Fridays keep working
  await send(admin, options, app.LarryOptions.abi, 'setDailyExpiries', [[ETH_MARKET], false])
  const t1 = await now()
  let e2 = t1 - ((t1 - 28800n) % DAY) + DAY
  if (e2 <= t1 + 3600n) e2 += DAY
  if (e2 % WEEK === FRIDAY_0800) e2 += DAY
  await reverts(read(options, app.LarryOptions.abi, 'quote', [ETH_MARKET, true, wad(3000), e2, wad(1)]), 'BadExpiry')
  await read(options, app.LarryOptions.abi, 'quote', [ETH_MARKET, true, wad(3000), await nextExpiry(), wad(1)])
  await assertSolvent()
})

test('options: setMarkets lists several markets in one transaction', async () => {
  const btcFeed = await deploy(keeper, mocks.MockAggregator, [8, 'BTC / USD', feedPx(100000)])
  await reverts(send(admin, options, app.LarryOptions.abi, 'setMarkets', [[1n, 2n], [optMarket(btcFeed)]]), 'BadParams')
  await reverts(send(alice, options, app.LarryOptions.abi, 'setMarkets', [[1n], [optMarket(btcFeed)]]), 'OwnableUnauthorizedAccount')
  await send(admin, options, app.LarryOptions.abi, 'setMarkets', [[1n, 2n], [optMarket(btcFeed), { ...optMarket(btcFeed), enabled: false }]])
  const m1 = await read(options, app.LarryOptions.abi, 'markets', [1n])
  const m2 = await read(options, app.LarryOptions.abi, 'markets', [2n])
  assert.equal(m1[0].toLowerCase(), btcFeed.toLowerCase())
  assert.equal(m1[7], true)
  assert.equal(m2[7], false)
})

test('admin: ownership transfer is two step', async () => {
  await send(admin, pool, app.LarryPool.abi, 'transferOwnership', [bob])
  assert.equal((await P('owner')).toLowerCase(), admin.toLowerCase())
  await send(bob, pool, app.LarryPool.abi, 'acceptOwnership')
  assert.equal((await P('owner')).toLowerCase(), bob.toLowerCase())
})

// ----------------------------------------------------------------- arena

test('arena: agents join with a unique name and public limits that can only go down', async () => {
  const arena = await deploy(admin, app.LarryArena, [perps, options])
  const A = (fn, args) => read(arena, app.LarryArena.abi, fn, args)
  assert.equal(await A('startBlock'), (await pub.getBlockNumber()))
  // a position opened before joining is not the agent's arena history
  await send(alice, perps, app.LarryPerps.abi, 'openPosition', [ETH_MARKET, true, usd(100), usd(500), wad(3010)])

  for (const bad of ['ab', ' Owl', 'Owl ', 'Night_Owl!', 'x'.repeat(25), '-Owl']) {
    await reverts(send(alice, arena, app.LarryArena.abi, 'join', [bad, usd(50), usd(200)]), 'BadName')
  }
  await reverts(send(alice, arena, app.LarryArena.abi, 'join', ['Night Owl', 0n, usd(200)]), 'BadLimits')
  await reverts(send(alice, arena, app.LarryArena.abi, 'join', ['Night Owl', usd(50), usd(10)]), 'BadLimits')
  await send(alice, arena, app.LarryArena.abi, 'join', ['Night Owl', usd(50), usd(200)])
  await reverts(send(alice, arena, app.LarryArena.abi, 'join', ['Owl Two', usd(50), usd(200)]), 'AlreadyJoined')
  await reverts(send(bob, arena, app.LarryArena.abi, 'join', ['night OWL', usd(50), usd(200)]), 'NameTaken')
  await send(bob, arena, app.LarryArena.abi, 'join', ['Bob.bot-2_x', usd(20), usd(20)])

  const a = await A('getAgent', [alice])
  assert.equal(a.name, 'Night Owl')
  assert.equal(a.firstPerpId, 2n) // the position opened before joining has id 1
  assert.equal(a.firstOptionId, 1n)
  assert.equal(a.maxPerTrade, usd(50))
  assert.equal(await A('agentCount'), 2n)
  const [addrs, info] = await A('agents', [0n, 10n])
  assert.deepEqual(addrs.map((x) => x.toLowerCase()), [alice, bob].map((x) => x.toLowerCase()))
  assert.equal(info[1].name, 'Bob.bot-2_x')
  assert.equal((await A('agents', [5n, 10n]))[0].length, 0)

  // limits only tighten
  await reverts(send(alice, arena, app.LarryArena.abi, 'lowerLimits', [usd(60), usd(200)]), 'BadLimits')
  await reverts(send(alice, arena, app.LarryArena.abi, 'lowerLimits', [usd(50), usd(300)]), 'BadLimits')
  await send(alice, arena, app.LarryArena.abi, 'lowerLimits', [usd(25), usd(100)])
  assert.equal((await A('getAgent', [alice])).maxPerDay, usd(100))
  await reverts(send(keeper, arena, app.LarryArena.abi, 'lowerLimits', [usd(1), usd(1)]), 'NotJoined')

  // renaming frees the old name
  await send(alice, arena, app.LarryArena.abi, 'rename', ['Owl Prime'])
  assert.equal((await A('nameHolder', [keccakName('night owl')])).toLowerCase(), '0x0000000000000000000000000000000000000000')
  await send(keeper, arena, app.LarryArena.abi, 'join', ['Night Owl', usd(5), usd(5)])
  assert.equal((await A('getAgent', [alice])).name, 'Owl Prime')

  // the owner moderates, nobody else
  await reverts(send(alice, arena, app.LarryArena.abi, 'setHidden', [bob, true]), 'OwnableUnauthorizedAccount')
  await send(admin, arena, app.LarryArena.abi, 'setHidden', [bob, true])
  assert.equal((await A('getAgent', [bob])).hidden, true)
  await send(admin, arena, app.LarryArena.abi, 'setJoinsPaused', [true])
  await reverts(send(lp, arena, app.LarryArena.abi, 'join', ['LP Agent', usd(5), usd(5)]), 'JoinsPaused')
})

// ------------------------------------------------------------------ heat

test('heat: a HeatFeed lists as a perps market, longs win when whales buy, moves are capped', async () => {
  const idx = (v) => parseUnits(String(v), 8)
  const feed = await deploy(admin, app.HeatFeed, ['NVDA HEAT', keeper, 2000, idx(100)])
  const H = (fn, args) => read(feed, app.HeatFeed.abi, fn, args)
  assert.equal(await H('decimals'), 8)
  assert.equal((await H('latestRoundData'))[1], idx(100))
  const HEAT_MARKET = 30n
  await send(admin, perps, app.LarryPerps.abi, 'setMarket', [HEAT_MARKET, { ...perpMarket(feed), maxLeverage: 5 }])
  assert.equal(await read(perps, app.LarryPerps.abi, 'price', [HEAT_MARKET]), wad(100))

  // only the updater posts, within range, at most 20% a step
  await reverts(send(alice, feed, app.HeatFeed.abi, 'update', [idx(110)]), 'NotUpdater')
  await reverts(send(keeper, feed, app.HeatFeed.abi, 'update', [idx(121)]), 'MoveTooLarge')
  await reverts(send(admin, feed, app.HeatFeed.abi, 'setMaxMoveBps', [9000]), 'BadParams')

  // long heat at 100 with 100 USDG, 450 size, whales pile in: 100 -> 120 -> 140
  const before = await bal(alice)
  await send(alice, perps, app.LarryPerps.abi, 'openPosition', [HEAT_MARKET, true, usd(100), usd(450), wad(101)])
  await send(keeper, feed, app.HeatFeed.abi, 'update', [idx(120)])
  await send(keeper, feed, app.HeatFeed.abi, 'update', [idx(140)])
  assert.equal(await H('latestRound'), 3n)
  const [id] = await posIdsOf(alice)
  await send(alice, perps, app.LarryPerps.abi, 'closePosition', [id, wad(139)])
  const gain = Number(formatUnits((await bal(alice)) - before, 6))
  assert.ok(gain > 170 && gain < 180, `gain ${gain}`) // +40% on 450 size, minus fees

  // the market halts when updates stop
  await warp(3601)
  await reverts(send(alice, perps, app.LarryPerps.abi, 'openPosition', [HEAT_MARKET, true, usd(100), usd(200), wad(150)]), 'StalePrice')
  await assertSolvent()
})
