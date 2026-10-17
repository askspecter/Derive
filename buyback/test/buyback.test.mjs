// Runs the buyback bot against real Uniswap V2 and V3 contracts on a local Hardhat chain, with a test
// token at the $LARRY address. Needs `npx hardhat node` on :8545 and UNISWAP_DIR pointing at a folder
// with @uniswap/v2-core, v2-periphery, v3-core and v3-periphery installed (npm i in any folder).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import httpServer from 'node:http'
import { promisify } from 'node:util'
import { createPublicClient, createWalletClient, createTestClient, defineChain, http, parseEther, parseUnits, maxUint256, formatUnits, encodeFunctionData } from 'viem'

const RPC = 'http://127.0.0.1:8545'
const LARRY = '0x72587018a341d5B668C0479e73b2Ee1c8D06f4f4'
const DEAD = '0x000000000000000000000000000000000000dEaD'
const BOT_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' // hardhat account 2
const chain = defineChain({ id: 4663, name: 'Local', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } })
const pub = createPublicClient({ chain, transport: http(RPC) })
const tc = createTestClient({ chain, mode: 'hardhat', transport: http(RPC) })
const app = JSON.parse(fs.readFileSync(new URL('../../src/contracts/artifacts.json', import.meta.url)))
const mocks = JSON.parse(fs.readFileSync(new URL('../../test/artifacts/mocks.json', import.meta.url)))
const U = process.env.UNISWAP_DIR
const art = (p) => JSON.parse(fs.readFileSync(path.join(U, 'node_modules/@uniswap', p)))
const sh = promisify(execFile)
const bot = new URL('../larry-buyback.mjs', import.meta.url).pathname

let owner, w, usdg, weth, v2router, v3router, quoter
const send = async (args) => {
  const r = await pub.waitForTransactionReceipt({ hash: await w.writeContract(args) })
  assert.equal(r.status, 'success')
  return r
}
const deploy = async (a, args = []) => (await pub.waitForTransactionReceipt({ hash: await w.deployContract({ abi: a.abi, bytecode: a.bytecode?.object ?? a.bytecode ?? a.evm.bytecode.object, args }) })).contractAddress
const dead = async () => Number(formatUnits(await pub.readContract({ address: LARRY, abi: mocks.MockERC20.abi, functionName: 'balanceOf', args: [DEAD] }), 18))
const run = async (env) => {
  const state = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bb-')), 's.json')
  const { stdout } = await sh(process.execPath, [bot, 'run'], { env: { PATH: process.env.PATH, BUYBACK_RPC_URL: RPC, BUYBACK_PRIVATE_KEY: BOT_KEY, BUYBACK_STATE: state, BUYBACK_EVERY_SECONDS: '2', BUYBACK_JITTER: '0', ...env } })
  return { out: stdout, state: JSON.parse(fs.existsSync(state) ? fs.readFileSync(state, 'utf8') : '{}') }
}

before(async () => {
  await tc.request({ method: 'hardhat_reset', params: [] })
  ;[owner] = await pub.request({ method: 'eth_accounts' })
  w = createWalletClient({ account: owner, chain, transport: http(RPC) })
  // test LARRY at the real address
  const tmp = await deploy(mocks.MockERC20, ['Larry', 'LARRY', 18])
  await tc.request({ method: 'hardhat_setCode', params: [LARRY, await pub.getCode({ address: tmp })] })
  usdg = await deploy(mocks.MockERC20, ['Global Dollar', 'USDG', 6])
  await send({ address: LARRY, abi: mocks.MockERC20.abi, functionName: 'mint', args: [owner, parseUnits('1000000000', 18)] })
  await send({ address: usdg, abi: mocks.MockERC20.abi, functionName: 'mint', args: [owner, parseUnits('1000000', 6)] })
  await send({ address: usdg, abi: mocks.MockERC20.abi, functionName: 'mint', args: ['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', parseUnits('100', 6)] }) // the bot wallet

  // Uniswap V2: ETH and USDG pools, 1 ETH = 100M LARRY, 1 USDG = 30k LARRY
  weth = await deploy(art('v2-periphery/build/WETH9.json'))
  const factory = await deploy(art('v2-core/build/UniswapV2Factory.json'), [owner])
  v2router = await deploy(art('v2-periphery/build/UniswapV2Router02.json'), [factory, weth])
  const V2 = art('v2-periphery/build/UniswapV2Router02.json').abi
  for (const t of [LARRY, usdg]) await send({ address: t, abi: mocks.MockERC20.abi, functionName: 'approve', args: [v2router, maxUint256] })
  const dl = BigInt(Math.floor(Date.now() / 1000) + 3600)
  await send({ address: v2router, abi: V2, functionName: 'addLiquidityETH', args: [LARRY, parseUnits('100000000', 18), 0n, 0n, owner, dl], value: parseEther('1') })
  await send({ address: v2router, abi: V2, functionName: 'addLiquidity', args: [usdg, LARRY, parseUnits('3000', 6), parseUnits('90000000', 18), 0n, 0n, owner, dl] })

  // Uniswap V3: ETH pool at fee 3000, full range
  const v3factory = await deploy(art('v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json'))
  v3router = await deploy(art('v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json'), [v3factory, weth])
  quoter = await deploy(art('v3-periphery/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json'), [v3factory, weth])
  const npmArt = art('v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json')
  const npm = await deploy(npmArt, [v3factory, weth, owner])
  const [t0, t1] = BigInt(weth) < BigInt(LARRY) ? [weth, LARRY] : [LARRY, weth]
  // price = token1 per token0; LARRY per WETH is 1e8, so sqrtPrice = sqrt(p) * 2^96
  const p = t0 === weth ? 1e8 : 1e-8
  const sqrtP = BigInt(Math.floor(Math.sqrt(p) * 2 ** 48)) * 2n ** 48n
  await send({ address: npm, abi: npmArt.abi, functionName: 'createAndInitializePoolIfNecessary', args: [t0, t1, 3000, sqrtP] })
  await send({ address: LARRY, abi: mocks.MockERC20.abi, functionName: 'approve', args: [npm, maxUint256] })
  const amt = (t) => (t === weth ? parseEther('1') : parseUnits('100000000', 18))
  await send({
    address: npm, abi: npmArt.abi, functionName: 'mint', value: parseEther('1'),
    args: [{ token0: t0, token1: t1, fee: 3000, tickLower: -887220, tickUpper: 887220, amount0Desired: amt(t0), amount1Desired: amt(t1), amount0Min: 0n, amount1Min: 0n, recipient: owner, deadline: dl }],
  })
})

test('v2, paying ETH: buys and burns every interval, straight to the dead address', async () => {
  const before = await dead()
  const { out, state } = await run({ BUYBACK_DEX: 'v2', BUYBACK_ROUTER: v2router, BUYBACK_PAY: 'eth', BUYBACK_AMOUNT: '0.00001', BUYBACK_MAX_PER_DAY: '1', BUYBACK_MAX_RUNS: '3' })
  assert.equal((out.match(/bought and burned/g) ?? []).length, 3, out)
  const burned = (await dead()) - before
  assert.ok(burned > 2900 && burned < 3000, `burned ${burned}`) // ~1000 LARRY per 0.00001 ETH, minus the 0.3% pool fee
  assert.equal(state.buys, 3)
  assert.equal(state.spent, parseEther('0.00003').toString())
})

test('v2, paying USDG: approves once, then each buy is a burn', async () => {
  const before = await dead()
  const { out } = await run({ BUYBACK_DEX: 'v2', BUYBACK_ROUTER: v2router, BUYBACK_PAY: usdg, BUYBACK_AMOUNT: '0.05', BUYBACK_MAX_PER_DAY: '10', BUYBACK_MAX_RUNS: '2' })
  assert.match(out, /approved USDG/)
  assert.equal((out.match(/bought and burned/g) ?? []).length, 2, out)
  const burned = (await dead()) - before
  assert.ok(burned > 2900 && burned < 3000, `burned ${burned}`) // 0.1 USDG at 30k LARRY each
})

test('stops at the daily budget', async () => {
  const before = await dead()
  const { out, state } = await run({ BUYBACK_DEX: 'v2', BUYBACK_ROUTER: v2router, BUYBACK_PAY: 'eth', BUYBACK_AMOUNT: '0.00001', BUYBACK_MAX_PER_DAY: '0.000025', BUYBACK_MAX_RUNS: '4' })
  assert.equal((out.match(/bought and burned/g) ?? []).length, 3, out) // 0.00001 + 0.00001 + the last 0.000005
  assert.match(out, /daily budget/)
  assert.equal(state.spent, parseEther('0.000025').toString())
  assert.ok((await dead()) - before < 2500)
})

test('v3 with the quoter', async () => {
  const before = await dead()
  const { out } = await run({ BUYBACK_DEX: 'v3', BUYBACK_ROUTER: v3router, BUYBACK_QUOTER: quoter, BUYBACK_V3_FEE: '3000', BUYBACK_PAY: 'eth', BUYBACK_AMOUNT: '0.00001', BUYBACK_MAX_PER_DAY: '1', BUYBACK_MAX_RUNS: '2' })
  assert.equal((out.match(/bought and burned/g) ?? []).length, 2, out)
  const burned = (await dead()) - before
  assert.ok(burned > 1900 && burned < 2000, `burned ${burned}`)
})

test('dry run sends nothing; check prints a quote', async () => {
  const before = await dead()
  const { out } = await run({ BUYBACK_DEX: 'v2', BUYBACK_ROUTER: v2router, BUYBACK_PAY: 'eth', BUYBACK_DRY_RUN: '1', BUYBACK_MAX_RUNS: '1' })
  assert.match(out, /dry run: .* would buy and burn about/)
  assert.equal(await dead(), before)
  const { stdout } = await sh(process.execPath, [bot, 'check'], { env: { PATH: process.env.PATH, BUYBACK_RPC_URL: RPC, BUYBACK_ROUTER: v2router, BUYBACK_AMOUNT: '0.00001' } })
  assert.match(stdout, /buys about 99\d LARRY/)
})

// ------------------------------------------------------------ LarryBuyback contract

const BOT = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const B = (fn, args = []) => pub.readContract({ address: bb, abi: app.LarryBuyback.abi, functionName: fn, args })
let bb
async function reverts(p, name) {
  await assert.rejects(p, (e) => (String(e.shortMessage ?? '') + String(e.message ?? '')).includes(name) || assert.fail(`expected ${name}: ${e.shortMessage}`))
}

test('contract: deploy, fund, and only the owner configures it', async () => {
  bb = await deploy(app.LarryBuyback, [LARRY, BOT, parseEther('0.001'), parseEther('0.003')])
  await w.sendTransaction({ to: bb, value: parseEther('0.01') })
  await pub.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: bb, value: 0n }) })
  await reverts(send({ address: bb, abi: app.LarryBuyback.abi, functionName: 'setTarget', args: [LARRY, true] }), 'BadParams')
  await send({ address: bb, abi: app.LarryBuyback.abi, functionName: 'setTarget', args: [v2router, true] })
  const bot = createWalletClient({ account: BOT, chain, transport: http(RPC) })
  await reverts(pub.simulateContract({ account: BOT, address: bb, abi: app.LarryBuyback.abi, functionName: 'setTarget', args: [BOT, true] }), 'OwnableUnauthorizedAccount')
  assert.equal(await pub.getBalance({ address: bb }), parseEther('0.01'))
  assert.ok(bot)
})

test('contract: the bot buys through a router and every token goes to the dead address', async () => {
  const before = await dead()
  const { out, state } = await run({ BUYBACK_CONTRACT: bb, BUYBACK_ROUTE: 'v2', BUYBACK_ROUTER: v2router, BUYBACK_AMOUNT: '0.0001', BUYBACK_MAX_RUNS: '2' })
  assert.equal((out.match(/bought and burned/g) ?? []).length, 2, out)
  const burned = (await dead()) - before
  assert.ok(burned > 19000 && burned < 20000, `burned ${burned}`)
  assert.equal(await pub.readContract({ address: LARRY, abi: mocks.MockERC20.abi, functionName: 'balanceOf', args: [bb] }), 0n)
  assert.equal(await B('buys'), 2n)
  assert.equal(await B('totalSpent'), parseEther('0.0002'))
  assert.equal(state.buys, 2)
  assert.equal(await pub.getBalance({ address: bb }), parseEther('0.0098'))
})

test('contract: routes through the 0x API, with the contract as taker', async () => {
  const seen = []
  const srv = httpServer.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x')
    seen.push({ path: u.pathname, q: Object.fromEntries(u.searchParams), key: req.headers['0x-api-key'], version: req.headers['0x-version'] })
    const amount = BigInt(u.searchParams.get('sellAmount'))
    const outs = await pub.readContract({ address: v2router, abi: art('v2-periphery/build/UniswapV2Router02.json').abi, functionName: 'getAmountsOut', args: [amount, [weth, LARRY]] })
    const minOut = (outs[1] * 99n) / 100n
    const data = encodeFunctionData({ abi: art('v2-periphery/build/UniswapV2Router02.json').abi, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens', args: [minOut, [weth, LARRY], u.searchParams.get('taker'), 9999999999n] })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ liquidityAvailable: true, buyAmount: outs[1].toString(), minBuyAmount: minOut.toString(), transaction: { to: v2router, data, value: amount.toString(), gas: '300000' } }))
  })
  await new Promise((r) => srv.listen(0, r))
  try {
    const before = await dead()
    const { out } = await run({ BUYBACK_CONTRACT: bb, BUYBACK_ROUTE: '0x', BUYBACK_0X_API_KEY: 'test-key', BUYBACK_0X_URL: `http://127.0.0.1:${srv.address().port}`, BUYBACK_AMOUNT: '0.0001', BUYBACK_MAX_RUNS: '2' })
    assert.equal((out.match(/bought and burned/g) ?? []).length, 2, out)
    assert.ok((await dead()) - before > 19000)
    assert.equal(seen[0].path, '/swap/allowance-holder/quote')
    assert.equal(seen[0].q.taker.toLowerCase(), bb.toLowerCase())
    assert.equal(seen[0].q.buyToken.toLowerCase(), LARRY.toLowerCase())
    assert.equal(seen[0].q.chainId, '4663')
    assert.equal(seen[0].key, 'test-key')
    assert.equal(seen[0].version, 'v2')
  } finally {
    srv.close()
  }
})

test('contract: enforces its caps, the minimum output and the target list onchain', async () => {
  const V2 = art('v2-periphery/build/UniswapV2Router02.json').abi
  const swap = (to) => encodeFunctionData({ abi: V2, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens', args: [0n, [weth, LARRY], to, 9999999999n] })
  const sim = (args, account = BOT) => pub.simulateContract({ account, address: bb, abi: app.LarryBuyback.abi, functionName: 'buyAndBurn', args })
  await reverts(sim([v2router, swap(bb), parseEther('0.002'), 0n]), 'OverLimit') // above max per buy
  await reverts(sim([v2router, swap(bb), parseEther('0.0001'), parseUnits('99999999', 18)]), 'TooLittleOut')
  await reverts(sim([v2router, swap(BOT), parseEther('0.0001'), 0n]), 'TooLittleOut') // swap paying someone else gets nothing burned
  await reverts(sim([weth, '0x', parseEther('0.0001'), 0n]), 'TargetNotAllowed')
  await reverts(sim([v2router, swap(bb), parseEther('0.0001'), 0n], owner.slice(0, 2) + '1'.repeat(40)), 'NotKeeper')
  // daily cap: 0.0004 spent of 0.003, three more at 0.001 would pass it
  const bot = createWalletClient({ account: BOT, chain, transport: http(RPC) })
  for (let i = 0; i < 2; i++) await pub.waitForTransactionReceipt({ hash: await bot.writeContract({ address: bb, abi: app.LarryBuyback.abi, functionName: 'buyAndBurn', args: [v2router, swap(bb), parseEther('0.001'), 1n] }) })
  await reverts(sim([v2router, swap(bb), parseEther('0.001'), 1n]), 'OverLimit')
  assert.equal(await B('leftToday'), parseEther('0.0006'))
  await tc.increaseTime({ seconds: 86_400 })
  await tc.mine({ blocks: 1 })
  assert.equal(await B('leftToday'), parseEther('0.003'))
})

test('contract: anyone burns stray LARRY, the owner pauses and withdraws', async () => {
  await send({ address: LARRY, abi: mocks.MockERC20.abi, functionName: 'transfer', args: [bb, parseUnits('500', 18)] })
  const before = await dead()
  const bot = createWalletClient({ account: BOT, chain, transport: http(RPC) })
  await pub.waitForTransactionReceipt({ hash: await bot.writeContract({ address: bb, abi: app.LarryBuyback.abi, functionName: 'burnHeld' }) })
  assert.equal((await dead()) - before, 500)
  await send({ address: bb, abi: app.LarryBuyback.abi, functionName: 'setPaused', args: [true] })
  await reverts(pub.simulateContract({ account: BOT, address: bb, abi: app.LarryBuyback.abi, functionName: 'buyAndBurn', args: [v2router, '0x', 1n, 0n] }), 'Paused')
  const held = await pub.getBalance({ address: bb })
  await send({ address: bb, abi: app.LarryBuyback.abi, functionName: 'withdraw', args: [owner, held] })
  assert.equal(await pub.getBalance({ address: bb }), 0n)
})

// ------------------------------------------------------------ Uniswap V4

test('contract: buys on a Uniswap V4 ETH pool and the PoolManager pays the dead address', async () => {
  const v4 = (n) => JSON.parse(fs.readFileSync(path.join(U, `node_modules/@uniswap/v4-core/out/${n}.sol/${n}.json`)))
  const PM = v4('PoolManager')
  const pm = await deploy({ abi: PM.abi, bytecode: PM.bytecode.object }, [owner])
  const key = { currency0: '0x0000000000000000000000000000000000000000', currency1: LARRY, fee: 3000, tickSpacing: 60, hooks: '0x0000000000000000000000000000000000000000' }
  // 1 ETH = 100M LARRY: sqrtPrice = sqrt(1e8) * 2^96
  await send({ address: pm, abi: PM.abi, functionName: 'initialize', args: [key, 10_000n * 2n ** 96n] })
  const LT = v4('PoolModifyLiquidityTest')
  const lp = await deploy({ abi: LT.abi, bytecode: LT.bytecode.object }, [pm])
  await send({ address: LARRY, abi: mocks.MockERC20.abi, functionName: 'approve', args: [lp, maxUint256] })
  await send({ address: lp, abi: LT.abi, functionName: 'modifyLiquidity', args: [key, { tickLower: -887220, tickUpper: 887220, liquidityDelta: 10n ** 22n, salt: '0x' + '0'.repeat(64) }, '0x'], value: parseEther('1.1') })

  const v4bb = await deploy(app.LarryBuyback, [LARRY, BOT, parseEther('0.001'), parseEther('0.01')])
  await pub.waitForTransactionReceipt({ hash: await w.sendTransaction({ to: v4bb, value: parseEther('0.005') }) })
  await reverts(send({ address: v4bb, abi: app.LarryBuyback.abi, functionName: 'setV4Pool', args: [pm, { ...key, currency1: usdg }] }), 'BadParams')
  await send({ address: v4bb, abi: app.LarryBuyback.abi, functionName: 'setV4Pool', args: [pm, key] })
  // the callback only runs inside the contract's own unlock
  await reverts(pub.simulateContract({ account: BOT, address: v4bb, abi: app.LarryBuyback.abi, functionName: 'unlockCallback', args: ['0x'] }), 'NotKeeper')

  const before = await dead()
  const { out, state } = await run({ BUYBACK_CONTRACT: v4bb, BUYBACK_ROUTE: 'v4', BUYBACK_AMOUNT: '0.0001', BUYBACK_MAX_RUNS: '3' })
  assert.equal((out.match(/bought and burned/g) ?? []).length, 3, out)
  const burned = (await dead()) - before
  assert.ok(burned > 29000 && burned < 30000, `burned ${burned}`) // 0.0003 ETH at 100M LARRY per ETH, minus the 0.3% fee
  assert.equal(await pub.readContract({ address: v4bb, abi: app.LarryBuyback.abi, functionName: 'buys' }), 3n)
  assert.equal(await pub.getBalance({ address: v4bb }), parseEther('0.0047'))
  assert.equal(await pub.readContract({ address: LARRY, abi: mocks.MockERC20.abi, functionName: 'balanceOf', args: [v4bb] }), 0n)
  assert.equal(state.buys, 3)

  // detect reads the pool key from a swap transaction
  const hash = out.match(/tx\/(0x[0-9a-f]{64})/)[1]
  const { stdout } = await sh(process.execPath, [bot, 'detect', hash], { env: { PATH: process.env.PATH, BUYBACK_RPC_URL: RPC } })
  assert.match(stdout, new RegExp(`Uniswap V4 PoolManager: ${pm}`, 'i'))
  assert.match(stdout, /currency0 0x0{40} \(ETH\)/)
  assert.match(stdout, /fee 3000, tickSpacing 60, hooks 0x0{40}/)

  // a minimum above what the pool gives reverts
  await reverts(pub.simulateContract({ account: BOT, address: v4bb, abi: app.LarryBuyback.abi, functionName: 'buyAndBurnV4', args: [parseEther('0.0001'), parseUnits('20000', 18)] }), 'TooLittleOut')
  await reverts(pub.simulateContract({ account: BOT, address: v4bb, abi: app.LarryBuyback.abi, functionName: 'buyAndBurnV4', args: [parseEther('0.002'), 0n] }), 'OverLimit')
})
