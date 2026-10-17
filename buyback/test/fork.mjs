// Runs the website's buyback keeper (src/lib/buybackKeeper.ts) against a Hardhat fork of Robinhood Chain
// mainnet: the real $LARRY token and its real Pons pool. Nothing is sent to mainnet.
//   npx hardhat node --port 8546 --fork https://rpc.mainnet.chain.robinhood.com
//   node buyback/test/fork.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseEther, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { build } from '../../node_modules/esbuild/lib/main.js'

const RPC = process.env.FORK_RPC ?? 'http://127.0.0.1:8546'
const LARRY = '0x72587018a341d5B668C0479e73b2Ee1c8D06f4f4'
const DEAD = '0x000000000000000000000000000000000000dEaD'
const chain = defineChain({ id: 4663, name: 'Fork', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } })
const pub = createPublicClient({ chain, transport: http(RPC) })
const app = JSON.parse(fs.readFileSync(new URL('../../src/contracts/artifacts.json', import.meta.url)))
const [owner] = await pub.request({ method: 'eth_accounts' })
const ow = createWalletClient({ account: owner, chain, transport: http(RPC) })
const wait = (hash) => pub.waitForTransactionReceipt({ hash })

// the website's keeper code, bundled for node
const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kf-')), 'k.mjs')
await build({ entryPoints: [new URL('../../src/lib/buybackKeeper.ts', import.meta.url).pathname], bundle: true, format: 'esm', platform: 'node', outfile, define: { 'import.meta.env': '{}' }, logLevel: 'error' })
const { keeperTick } = await import(outfile)

const keeper = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const bb = (await wait(await ow.deployContract({ abi: app.LarryBuyback.abi, bytecode: app.LarryBuyback.bytecode, args: [LARRY, keeper.address, parseEther('0.001'), parseEther('0.02')] }))).contractAddress
await wait(await ow.sendTransaction({ to: bb, value: parseEther('0.02') }))
await wait(await ow.writeContract({ address: bb, abi: app.LarryBuyback.abi, functionName: 'setTarget', args: ['0x4d17d7ea9f4975738d088e7ec6c15062a6215f16', true] }))
console.log('LarryBuyback on the fork', bb)

const dead = async () => Number(formatEther(await pub.readContract({ address: LARRY, abi: erc20Abi, functionName: 'balanceOf', args: [DEAD] })))
const kw = createWalletClient({ account: keeper, chain, transport: http(RPC) })
const before = await dead()
console.log('LARRY in the dead address before', before.toLocaleString('en-US'))
let total = 0
for (let i = 0; i < 3; i++) {
  const r = await keeperTick(pub, kw, keeper, bb, { route: 'pons', everySec: 10, amountEth: '0.0001', jitter: 0, slippageBps: 300 })
  assert.equal(r.ok, true, r.text)
  total += r.burned
  console.log(`buy ${i + 1}: ~${Math.round(r.burned).toLocaleString('en-US')} LARRY burned for ${formatEther(r.value)} ETH`)
}
const after = await dead()
console.log('LARRY in the dead address after', after.toLocaleString('en-US'), `(+${Math.round(after - before).toLocaleString('en-US')})`)
assert.ok(after - before > total * 0.97 && after - before < total * 1.03)
assert.equal(await pub.readContract({ address: LARRY, abi: erc20Abi, functionName: 'balanceOf', args: [bb] }), 0n)
assert.equal(await pub.readContract({ address: bb, abi: app.LarryBuyback.abi, functionName: 'buys' }), 3n)
console.log('fork test passed: real $LARRY bought on the real Pons pool and burned')
