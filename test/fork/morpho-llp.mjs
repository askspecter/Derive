// LLP as Morpho collateral, on a fork of Robinhood Chain mainnet: the real Morpho Blue, its AdaptiveCurve IRM,
// USDG and the live Larry Vault. Deploys LarryVaultOracle, creates the LLP / USDG market at 62.5% LLTV, then
// lends, deposits into the vault, posts LLP and borrows. Nothing touches mainnet.
//   npx hardhat node --port 8546 --fork https://rpc.mainnet.chain.robinhood.com
//   node test/fork/morpho-llp.mjs
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createPublicClient, createWalletClient, createTestClient, defineChain, http, parseAbi, erc20Abi, keccak256, encodeAbiParameters, maxUint256, formatUnits } from 'viem'

const RPC = process.env.FORK_RPC ?? 'http://127.0.0.1:8546'
const chain = defineChain({ id: 4663, name: 'Fork', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } })
const pub = createPublicClient({ chain, transport: http(RPC) })
const tc = createTestClient({ chain, mode: 'hardhat', transport: http(RPC) })
await tc.mine({ blocks: 1 })
const app = JSON.parse(fs.readFileSync(new URL('../../src/contracts/artifacts.json', import.meta.url)))
const MORPHO = '0x9d53d5e3bd5e8d4cbfa6db1ca238aea02e651010', IRM = '0x2bd3d5965b26b51814ac95127b2b80dd6ccc0fa1'
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', LLP = process.env.LLP ?? '0x600c49995c621f9c883e2c3117a5cecb44380843'
const LLTV = 625000000000000000n
const M = parseAbi([
  'struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }',
  'function createMarket(MarketParams marketParams)',
  'function supply(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)',
  'function supplyCollateral(MarketParams marketParams, uint256 assets, address onBehalf, bytes data)',
  'function borrow(MarketParams marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)',
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
])
const V = parseAbi(['function deposit(uint256 assets, address receiver) returns (uint256)', 'function balanceOf(address) view returns (uint256)', 'function maxDeposit(address) view returns (uint256)', 'function convertToAssets(uint256) view returns (uint256)'])
const [me] = await pub.request({ method: 'eth_accounts' })
const w = createWalletClient({ account: me, chain, transport: http(RPC) })
const send = async (args) => { const r = await pub.waitForTransactionReceipt({ hash: await w.writeContract(args) }); assert.equal(r.status, 'success'); return r }

// test USDG: impersonate the Morpho contract, which holds the USDG lent in other markets
await tc.impersonateAccount({ address: MORPHO }); await tc.setBalance({ address: MORPHO, value: 10n ** 18n })
const mw = createWalletClient({ account: MORPHO, chain, transport: http(RPC) })
await pub.waitForTransactionReceipt({ hash: await mw.writeContract({ address: USDG, abi: erc20Abi, functionName: 'transfer', args: [me, 3_000_000_000n] }) })
console.log('test USDG', formatUnits(await pub.readContract({ address: USDG, abi: erc20Abi, functionName: 'balanceOf', args: [me] }), 6))

const oracle = (await pub.waitForTransactionReceipt({ hash: await w.deployContract({ abi: app.LarryVaultOracle.abi, bytecode: app.LarryVaultOracle.bytecode, args: [LLP] }) })).contractAddress
const params = { loanToken: USDG, collateralToken: LLP, oracle, irm: IRM, lltv: LLTV }
const id = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }], [USDG, LLP, oracle, IRM, LLTV]))
await send({ address: MORPHO, abi: M, functionName: 'createMarket', args: [params] })
console.log('market', id, 'oracle price', await pub.readContract({ address: oracle, abi: app.LarryVaultOracle.abi, functionName: 'price' }))

for (const s of [MORPHO, LLP]) await send({ address: USDG, abi: erc20Abi, functionName: 'approve', args: [s, maxUint256] })
await send({ address: MORPHO, abi: M, functionName: 'supply', args: [params, 1_000_000_000n, 0n, me, '0x'] }) // lend 1,000 USDG
console.log('vault maxDeposit', formatUnits(await pub.readContract({ address: LLP, abi: V, functionName: 'maxDeposit', args: [me] }), 6))
await send({ address: LLP, abi: V, functionName: 'deposit', args: [1_000_000_000n, me] }) // 1,000 USDG into the Larry Vault
const llp = await pub.readContract({ address: LLP, abi: V, functionName: 'balanceOf', args: [me] })
console.log('LLP', formatUnits(llp, 9), 'worth', formatUnits(await pub.readContract({ address: LLP, abi: V, functionName: 'convertToAssets', args: [llp] }), 6), 'USDG')
await tc.increaseTime({ seconds: 86_401 }); await tc.mine({ blocks: 1 }) // the vault's 1 day lock
await send({ address: LLP, abi: erc20Abi, functionName: 'approve', args: [MORPHO, maxUint256] })
await send({ address: MORPHO, abi: M, functionName: 'supplyCollateral', args: [params, llp, me, '0x'] })
await assert.rejects(pub.simulateContract({ account: me, address: MORPHO, abi: M, functionName: 'borrow', args: [params, 626_000_000n, 0n, me, me] }), /insufficient collateral|reverted/i)
await send({ address: MORPHO, abi: M, functionName: 'borrow', args: [params, 600_000_000n, 0n, me, me] })
const mk = await pub.readContract({ address: MORPHO, abi: M, functionName: 'market', args: [id] })
console.log('borrowed 600 USDG against 1,000 USDG of LLP; market supply', formatUnits(mk[0], 6), 'borrow', formatUnits(mk[2], 6))
console.log('fork test passed: LLP works as Morpho collateral at 62.5%')
