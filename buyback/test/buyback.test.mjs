// Runs the buyback bot against real Uniswap V2 and V3 contracts on a local Hardhat chain, with a test
// token at the $LARRY address. Needs `npx hardhat node` on :8545 and UNISWAP_DIR pointing at a folder
// with @uniswap/v2-core, v2-periphery, v3-core and v3-periphery installed (npm i in any folder).
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createPublicClient, createWalletClient, createTestClient, defineChain, http, parseEther, parseUnits, maxUint256, formatUnits, encodePacked } from 'viem'

const RPC = 'http://127.0.0.1:8545'
const LARRY = '0x72587018a341d5B668C0479e73b2Ee1c8D06f4f4'
const DEAD = '0x000000000000000000000000000000000000dEaD'
const BOT_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' // hardhat account 2
const chain = defineChain({ id: 4663, name: 'Local', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } })
const pub = createPublicClient({ chain, transport: http(RPC) })
const tc = createTestClient({ chain, mode: 'hardhat', transport: http(RPC) })
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
