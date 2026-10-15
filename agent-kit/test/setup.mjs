// Local test chain for the agent kit: the Larry protocol on a Hardhat node (chain id 4663), four
// markets, a funded vault and daily expiries on ETH, BTC and LINK. Writes the addresses to argv[2].
// Run `npx hardhat node` from the repository root first.
import fs from 'node:fs'
import { createPublicClient, createTestClient, createWalletClient, defineChain, http, maxUint256, parseUnits } from '../../node_modules/viem/_esm/index.js'

const RPC = 'http://127.0.0.1:8545'
const chain = defineChain({ id: 4663, name: 'Local', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } })
const pub = createPublicClient({ chain, transport: http(RPC) })
await createTestClient({ chain, mode: 'hardhat', transport: http(RPC) }).request({ method: 'hardhat_reset', params: [] })
const mocks = JSON.parse(fs.readFileSync(new URL('../../test/artifacts/mocks.json', import.meta.url)))
const app = JSON.parse(fs.readFileSync(new URL('../../src/contracts/artifacts.json', import.meta.url)))
const accounts = await pub.request({ method: 'eth_accounts' })
const [admin, trader, lp] = accounts
const infra = accounts[9]
const W = (a) => createWalletClient({ account: a, chain, transport: http(RPC) })
const wait = (h) => pub.waitForTransactionReceipt({ hash: h })
const deploy = async (who, art, args) => (await wait(await W(who).deployContract({ abi: art.abi, bytecode: art.bytecode, args }))).contractAddress
const send = async (who, address, abi, functionName, args) => wait(await W(who).writeContract({ address, abi, functionName, args }))

await pub.request({ method: 'hardhat_setCode', params: ['0xcA11bde05977b3631167028862bE2a173976CA11', mocks.Multicall3.deployedBytecode] })
const usdg = await deploy(infra, mocks.MockERC20, ['Global Dollar', 'USDG', 6])
const pool = await deploy(admin, app.LarryPool, [usdg, parseUnits('50000', 6)])
const perps = await deploy(admin, app.LarryPerps, [pool])
const options = await deploy(admin, app.LarryOptions, [pool])
await send(admin, pool, app.LarryPool.abi, 'setProduct', [perps, true])
await send(admin, pool, app.LarryPool.abi, 'setProduct', [options, true])

// id, symbol, price, vol, stock
const M = [[0, 'ETH', 3420, 0.62, 0], [1, 'BTC', 104250, 0.48, 0], [3, 'LINK', 12.45, 0.75, 0], [4, 'TSLA', 412.3, 0.55, 1]]
const now = Number((await pub.getBlock()).timestamp)
for (const [id, sym, px, vol, stock] of M) {
  const feed = await deploy(infra, mocks.MockAggregator, [8, `${sym} / USD`, parseUnits(String(px), 8)])
  // a few rounds of history ending at the current price
  for (const [i, f] of [0.99, 1.01, 1].entries()) {
    await send(infra, feed, mocks.MockAggregator.abi, 'setAnswerAt', [parseUnits((px * f).toFixed(4), 8), BigInt(now - (2 - i) * 1200)])
  }
  await send(admin, perps, app.LarryPerps.abi, 'setMarket', [BigInt(id), { feed, heartbeat: 90000, maxLeverage: stock ? 10 : 20, openFeeBps: 10, closeFeeBps: 10, borrowBpsPerDay: 5, maintenanceBps: stock ? 200 : 100, liquidationFeeBps: 50, maxProfitMultiple: 9, maxOpenInterest: parseUnits('10000', 6), enabled: true }])
  await send(admin, options, app.LarryOptions.abi, 'setMarket', [BigInt(id), { feed, heartbeat: 90000, vol: parseUnits(String(vol), 18), spreadBps: 300, minPremiumBps: 5, maxExpiry: 63 * 86400, maxOpenNotional: parseUnits('20000', 6), enabled: true }])
}
await send(admin, options, app.LarryOptions.abi, 'setDailyExpiries', [[0n, 1n, 3n], true])
for (const who of [trader, lp]) await send(infra, usdg, mocks.MockERC20.abi, 'mint', [who, parseUnits('25000', 6)])
await send(lp, usdg, mocks.MockERC20.abi, 'approve', [pool, maxUint256])
await send(lp, pool, app.LarryPool.abi, 'deposit', [parseUnits('5000', 6), lp])

fs.writeFileSync(process.argv[2], JSON.stringify({ admin, trader, lp, usdg, pool, perps, options }, null, 2))
console.log('agent kit test chain ready', { pool, perps, options })
