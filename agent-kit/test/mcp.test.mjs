// End to end: a real MCP client drives the bundled server against a local Hardhat chain.
// Needs `npx hardhat node` on :8545 with the demo protocol (see test/setup.mjs).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { createPublicClient, createTestClient, createWalletClient, defineChain, http, parseUnits } from '../../node_modules/viem/_esm/index.js'

const RPC = 'http://127.0.0.1:8545'
const env = JSON.parse(fs.readFileSync(process.env.LARRY_TEST_ENV))
const TRADER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' // hardhat account 1
const chain = defineChain({ id: 4663, name: 'Local', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } })
const pub = createPublicClient({ chain, transport: http(RPC) })
const testClient = createTestClient({ chain, mode: 'hardhat', transport: http(RPC) })
const app = JSON.parse(fs.readFileSync(new URL('../../src/contracts/artifacts.json', import.meta.url)))
const mocks = JSON.parse(fs.readFileSync(new URL('../../test/artifacts/mocks.json', import.meta.url)))
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'larry-agent-'))

async function connect(extra = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL('../dist/larry-mcp.mjs', import.meta.url).pathname],
    env: { PATH: process.env.PATH, LARRY_RPC_URL: RPC, LARRY_OPTIONS: env.options, LARRY_PERPS: env.perps, LARRY_STATE_DIR: stateDir, ...extra },
  })
  const client = new Client({ name: 'larry-test', version: '1.0.0' })
  await client.connect(transport)
  return client
}
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  const text = r.content?.[0]?.text ?? ''
  return { error: !!r.isError, text, data: r.isError ? null : JSON.parse(text) }
}

let agent
before(async () => {
  agent = await connect({ LARRY_PRIVATE_KEY: TRADER_KEY, LARRY_MAX_PER_TRADE: '100', LARRY_MAX_PER_DAY: '300' })
})
after(async () => {
  await agent?.close()
})

test('lists the Larry tools', async () => {
  const { tools } = await agent.listTools()
  const names = tools.map((t) => t.name).sort()
  assert.deepEqual(names, [
    'larry_balances', 'larry_buy_option', 'larry_claim_option', 'larry_close_perp', 'larry_expiries', 'larry_limits', 'larry_markets',
    'larry_open_perp', 'larry_option_chain', 'larry_positions', 'larry_quote_option', 'larry_vault', 'larry_vault_deposit', 'larry_vault_withdraw',
  ])
  assert.equal(tools.find((t) => t.name === 'larry_markets').annotations.readOnlyHint, true)
  assert.equal(tools.find((t) => t.name === 'larry_buy_option').annotations.destructiveHint, true)
})

test('reads markets, expiries, the option chain and a quote', async () => {
  const m = await call(agent, 'larry_markets')
  const eth = m.data.find((x) => x.symbol === 'ETH')
  assert.equal(eth.price, 3420)
  assert.equal(eth.options.dailyExpiries, true)
  assert.equal(eth.perps.maxLeverage, 20)
  assert.equal(m.data.find((x) => x.symbol === 'TSLA').options.dailyExpiries, false)

  const e = await call(agent, 'larry_expiries', { symbol: 'eth' })
  assert.equal(e.data.expiries[0].zeroDte, true)

  const c = await call(agent, 'larry_option_chain', { symbol: 'ETH', expiry: '0dte' })
  assert.ok(c.data.strikes.length >= 8)
  assert.ok(c.data.strikes.every((s) => s.call > 0 && s.put > 0))

  const q = await call(agent, 'larry_quote_option', { symbol: 'ETH', type: 'call', strike: 3500, expiry: '0dte', contracts: 0.1 })
  assert.ok(q.data.totalCost > 0 && q.data.totalCost < 10)
  assert.equal(q.data.maxPayout, 350)

  const bad = await call(agent, 'larry_quote_option', { symbol: 'DOGE', type: 'call', strike: 1, expiry: '0dte', contracts: 1 })
  assert.equal(bad.error, true)
  assert.match(bad.text, /Unknown market DOGE/)
})

test('buys a 0DTE option, opens and closes a perp, deposits into the vault', async () => {
  const b = await call(agent, 'larry_buy_option', { symbol: 'ETH', type: 'call', strike: 3500, expiry: '0dte', contracts: 0.1 })
  assert.equal(b.error, false, b.text)
  assert.match(b.data.transactions.at(-1).hash, /^0x[0-9a-f]{64}$/)

  const p = await call(agent, 'larry_open_perp', { symbol: 'ETH', side: 'long', collateral: 50, leverage: 5 })
  assert.equal(p.error, false, p.text)
  assert.ok(p.data.size > 240 && p.data.size < 250)

  const pos = await call(agent, 'larry_positions')
  assert.equal(pos.data.options.length, 1)
  assert.equal(pos.data.options[0].status, 'active')
  assert.equal(pos.data.perps.length, 1)
  assert.equal(pos.data.perps[0].side, 'long')

  const cl = await call(agent, 'larry_close_perp', { id: pos.data.perps[0].id })
  assert.equal(cl.error, false, cl.text)
  assert.equal((await call(agent, 'larry_positions')).data.perps.length, 0)

  const d = await call(agent, 'larry_vault_deposit', { amount: 40 })
  assert.equal(d.error, false, d.text)
  const bal = await call(agent, 'larry_balances')
  assert.ok(bal.data.vaultValue > 39.9)
  assert.ok(bal.data.limits.spentToday > 90 && bal.data.limits.spentToday < 92)
})

test('enforces the per trade and daily limits', async () => {
  const big = await call(agent, 'larry_open_perp', { symbol: 'ETH', side: 'long', collateral: 150, leverage: 2 })
  assert.equal(big.error, true)
  assert.match(big.text, /per trade limit of 100/)
  // 91 spent of 300: two more trades of 100 fit, the third does not
  assert.equal((await call(agent, 'larry_vault_deposit', { amount: 100 })).error, false)
  assert.equal((await call(agent, 'larry_vault_deposit', { amount: 100 })).error, false)
  const over = await call(agent, 'larry_vault_deposit', { amount: 20 })
  assert.equal(over.error, true)
  assert.match(over.text, /Daily limit reached/)
})

test('read only, allow list and dry run modes', async () => {
  const ro = await connect({})
  const r1 = await call(ro, 'larry_buy_option', { symbol: 'ETH', type: 'put', strike: 3300, expiry: 'friday', contracts: 0.1 })
  assert.match(r1.text, /Read only/)
  assert.equal((await call(ro, 'larry_positions', { address: env.trader })).data.options.length, 1)
  await ro.close()

  const onlyOptions = await connect({ LARRY_PRIVATE_KEY: TRADER_KEY, LARRY_ALLOW: 'options', LARRY_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'larry-b-')) })
  const r2 = await call(onlyOptions, 'larry_open_perp', { symbol: 'ETH', side: 'short', collateral: 10, leverage: 2 })
  assert.match(r2.text, /perps is not allowed/)
  await onlyOptions.close()

  const dry = await connect({ LARRY_PRIVATE_KEY: TRADER_KEY, LARRY_DRY_RUN: '1', LARRY_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'larry-c-')) })
  const r3 = await call(dry, 'larry_buy_option', { symbol: 'ETH', type: 'put', strike: 3300, expiry: 'friday', contracts: 0.1 })
  assert.equal(r3.error, false, r3.text)
  assert.equal(r3.data.transactions.at(-1).dryRun, true)
  assert.equal((await call(dry, 'larry_positions')).data.options.length, 1) // nothing new was bought
  await dry.close()
})

test('settles and claims an expired 0DTE option', async () => {
  const pos = (await call(agent, 'larry_positions')).data.options[0]
  const expiry = Date.parse(pos.expiryDate) / 1000
  const [feed] = await pub.readContract({ address: env.options, abi: app.LarryOptions.abi, functionName: 'markets', args: [0n] })
  const t = Number((await pub.getBlock()).timestamp)
  await testClient.increaseTime({ seconds: expiry - t + 60 })
  await testClient.mine({ blocks: 1 })
  const [, , , , , , , , , infra] = await pub.request({ method: 'eth_accounts' })
  const w = createWalletClient({ account: infra, chain, transport: http(RPC) })
  await pub.waitForTransactionReceipt({ hash: await w.writeContract({ address: feed, abi: mocks.MockAggregator.abi, functionName: 'setAnswer', args: [parseUnits('3600', 8)] }) })

  const c = await call(agent, 'larry_claim_option', { id: pos.id })
  assert.equal(c.error, false, c.text)
  assert.equal(c.data.payout, 10) // (3600 - 3500) * 0.1
  const after = (await call(agent, 'larry_positions')).data.options[0]
  assert.equal(after.status, 'claimed')
  assert.equal(after.settlementPrice, 3600)
})
