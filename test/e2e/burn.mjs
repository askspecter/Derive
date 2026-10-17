// Browser test of the $LARRY burn tracker. Puts a test token at the real $LARRY address on a local
// Hardhat chain, burns some to the dead address, and checks the page reads totals from the token and
// shows each burn, including one sent while the page is open.
// Needs `npx hardhat node` on :8545 and the app running with VITE_RPC_URL=http://127.0.0.1:8545.
// Usage: PW=<path to playwright> node test/e2e/burn.mjs <site url> <screenshot dir>
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createPublicClient, createWalletClient, defineChain, http, parseUnits } from 'viem'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PW || 'playwright')
const [url, out] = process.argv.slice(2)
const RPC = 'http://127.0.0.1:8545'
const LARRY = '0x72587018a341d5b668c0479e73b2ee1c8d06f4f4'
const DEAD = '0x000000000000000000000000000000000000dEaD'
const chain = defineChain({ id: 4663, name: 'Local', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } })
const pub = createPublicClient({ chain, transport: http(RPC) })
const mocks = JSON.parse(fs.readFileSync(new URL('../artifacts/mocks.json', import.meta.url)))
const log = (...a) => console.log('•', ...a)

const [, holder] = await pub.request({ method: 'eth_accounts' })
const w = createWalletClient({ account: holder, chain, transport: http(RPC) })
const send = async (args) => pub.waitForTransactionReceipt({ hash: await w.writeContract({ abi: mocks.MockERC20.abi, ...args }) })

// A test ERC20 with 18 decimals, its code copied to the $LARRY address.
const tmp = (await pub.waitForTransactionReceipt({ hash: await w.deployContract({ abi: mocks.MockERC20.abi, bytecode: mocks.MockERC20.bytecode, args: ['Larry', 'LARRY', 18] }) })).contractAddress
await pub.request({ method: 'hardhat_setCode', params: [LARRY, await pub.getCode({ address: tmp })] })
await pub.request({ method: 'hardhat_setCode', params: ['0xcA11bde05977b3631167028862bE2a173976CA11', mocks.Multicall3.deployedBytecode] })
await send({ address: LARRY, functionName: 'mint', args: [holder, parseUnits('1000000000', 18)] })
await send({ address: LARRY, functionName: 'transfer', args: [DEAD, parseUnits('28595679', 18)] })
await send({ address: LARRY, functionName: 'transfer', args: [DEAD, parseUnits('2190000', 18)] })
log('local $LARRY with 30,785,679 burned')

const browser = await chromium.launch()
const errors = []
const open = async (explorer) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  await ctx.route(/blockscout\.com\/api/, (route) => (explorer ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(explorer) }) : route.fulfill({ status: 503, body: 'down' })))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  return page
}
const text = (page, t, timeout = 30000) => page.getByText(t, { exact: false }).first().waitFor({ timeout })

try {
  // Explorer down: totals from the token, burns read from chain logs.
  const page = await open(null)
  await page.goto(`${url}/#/burn`)
  await text(page, '30,785,679')
  await text(page, '3.08%')
  assert.equal(await page.locator('.burn-row').count(), 2)
  await text(page, '2,190,000 LARRY')
  log('totals from the contract, burns from chain logs')

  // A burn while the page is open shows up on its own.
  await send({ address: LARRY, functionName: 'transfer', args: [DEAD, parseUnits('1000000', 18)] })
  await text(page, '31,785,679', 40000)
  await page.locator('.burn-row.fresh').first().waitFor({ timeout: 40000 })
  assert.equal(await page.locator('.burn-row').count(), 3)
  log('new burn appears live and flashes')
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(out, 'burn-live.png'), fullPage: true })

  // Explorer up: the feed comes from its index, with times.
  const now = Date.now()
  const item = (v, minsAgo, h) => ({ transaction_hash: h, timestamp: new Date(now - minsAgo * 60_000).toISOString(), block_number: 100, from: { hash: '0x08A1e2F2f00000000000000000000000000a938' }, total: { value: parseUnits(v, 18).toString(), decimals: '18' }, token: { address: LARRY } })
  const p2 = await open({ items: [item('1000000', 3, '0x' + 'a'.repeat(64)), item('2190000', 95, '0x' + 'b'.repeat(64)), item('28595679', 3000, '0x' + 'c'.repeat(64))], next_page_params: null })
  await p2.goto(`${url}/#/burn`)
  await text(p2, '3m ago')
  await text(p2, '1h ago')
  await text(p2, '2d ago')
  log('explorer feed with times')

  await p2.goto(`${url}/#/`)
  await p2.locator('.burn.compact').scrollIntoViewIfNeeded()
  await text(p2, '31,785,679')
  await p2.locator('.burn.compact').screenshot({ path: path.join(out, 'burn-home.png') })
  await p2.setViewportSize({ width: 390, height: 900 })
  await p2.goto(`${url}/#/burn`)
  await text(p2, '31,785,679')
  await p2.waitForTimeout(1800)
  await p2.screenshot({ path: path.join(out, 'burn-mobile.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log('burn e2e passed')
} catch (e) {
  console.error('FAILED', e.message, errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
