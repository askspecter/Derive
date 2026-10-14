// Local end to end setup: deploys the infrastructure that already exists on Robinhood Chain
// (USDG and Chainlink feeds) as mocks, from an account that is NOT the admin, and funds two users.
// Usage: node test/e2e/setup.mjs <out.json>
import fs from 'node:fs'
import { createPublicClient, createWalletClient, http, parseUnits, defineChain } from 'viem'

const RPC = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const chain = defineChain({ id: 4663, name: 'Local', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } })
const pub = createPublicClient({ chain, transport: http(RPC) })
const mocks = JSON.parse(fs.readFileSync(new URL('../artifacts/mocks.json', import.meta.url)))
const accts = await pub.request({ method: 'eth_accounts' })
const infra = accts[9]
const w = createWalletClient({ account: infra, chain, transport: http(RPC) })
async function deploy(art, args) {
  const hash = await w.deployContract({ abi: art.abi, bytecode: art.bytecode, args })
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress
}
// Robinhood Chain has Multicall3 at its canonical address; the local chain gets a copy there.
await pub.request({ method: 'hardhat_setCode', params: ['0xcA11bde05977b3631167028862bE2a173976CA11', mocks.Multicall3.deployedBytecode] })
const usdg = await deploy(mocks.MockERC20, ['Global Dollar', 'USDG', 6])
const prices = { ETH: 3420, BTC: 104250, SOL: 182, HOOD: 118.4, TSLA: 412.3, NVDA: 186.7, AAPL: 247.1 }
const feeds = {}
for (const [s, p] of Object.entries(prices)) feeds[s] = await deploy(mocks.MockAggregator, [8, `${s} / USD`, parseUnits(String(p), 8)])
for (const who of [accts[1], accts[2]]) {
  const h = await w.writeContract({ address: usdg, abi: mocks.MockERC20.abi, functionName: 'mint', args: [who, parseUnits('1000000', 6)] })
  await pub.waitForTransactionReceipt({ hash: h })
}
// USED_ADMIN=1 simulates an admin wallet that already sent transactions before deploying.
if (process.env.USED_ADMIN) {
  const aw = createWalletClient({ account: accts[0], chain, transport: http(RPC) })
  for (let i = 0; i < 2; i++) await pub.waitForTransactionReceipt({ hash: await aw.sendTransaction({ to: accts[8], value: 1n }) })
}
const out = { usdg, feeds, admin: accts[0], trader: accts[1], lp: accts[2], infra }
fs.writeFileSync(process.argv[2] ?? 'e2e-env.json', JSON.stringify(out, null, 2))
console.log(JSON.stringify({ usdg, eth: feeds.ETH, admin: accts[0] }))
