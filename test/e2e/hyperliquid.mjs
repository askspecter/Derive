// Browser test of the Hyperliquid perps page against a mock Hyperliquid API. The mock checks every
// signature the way Hyperliquid does: wallet approvals must recover to the trader, orders to the
// trading key the trader approved. Needs a Hardhat node on :8545 (the test wallet signs through it)
// and the app running with VITE_LARRY_ADMIN set (the builder).
// Usage: PW=<path to playwright> node test/e2e/hyperliquid.mjs <site url> <screenshot dir>
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { recoverTypedDataAddress, zeroAddress } from 'viem'
import { createL1ActionHash } from '@nktkas/hyperliquid/signing'
import { ApproveAgentTypes, ApproveBuilderFeeTypes } from '@nktkas/hyperliquid/api/exchange'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PW || 'playwright')
const [url, out] = process.argv.slice(2)
const shim = fs.readFileSync(new URL('./wallet-shim.js', import.meta.url), 'utf8')
const TRADER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' // hardhat account 1
const BUILDER = (process.env.BUILDER ?? '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266').toLowerCase()
const log = (...a) => console.log('•', ...a)

// ------------------------------------------------------------ mock Hyperliquid
const coins = [
  ['BTC', 5, 40, 104250, 102900, 2.1e9],
  ['ETH', 4, 25, 3420.5, 3466, 1.2e9],
  ['HYPE', 2, 10, 41.27, 39.8, 3.1e8],
  ['DOGE', 0, 10, 0.18234, 0.1801, 9e7],
]
const state = { builderFee: 0, agents: [], positions: [], orders: [], accountValue: 1000 }

async function verifyUserSigned(body, types) {
  const { type, signatureChainId, ...message } = body.action
  const primaryType = Object.keys(types)[0]
  return recoverTypedDataAddress({
    domain: { name: 'HyperliquidSignTransaction', version: '1', chainId: parseInt(signatureChainId, 16), verifyingContract: zeroAddress },
    types,
    primaryType,
    message,
    signature: sig(body.signature),
  })
}
const sig = (s) => `${s.r}${s.s.slice(2)}${s.v.toString(16)}`
async function verifyL1(body) {
  const connectionId = createL1ActionHash({ action: body.action, nonce: body.nonce, vaultAddress: body.vaultAddress, expiresAfter: body.expiresAfter })
  return recoverTypedDataAddress({
    domain: { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: zeroAddress },
    types: { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
    primaryType: 'Agent',
    message: { source: 'a', connectionId },
    signature: sig(body.signature),
  })
}

async function info(body) {
  switch (body.type) {
    case 'metaAndAssetCtxs':
      return [
        { universe: coins.map(([name, szDecimals, maxLeverage]) => ({ name, szDecimals, maxLeverage, marginTableId: maxLeverage })), marginTables: [] },
        coins.map(([, , , px, prev, vol]) => ({ funding: '0.0000125', openInterest: String(vol / px / 10), prevDayPx: String(prev), dayNtlVlm: String(vol), premium: '0.0001', oraclePx: String(px), markPx: String(px), midPx: String(px), impactPxs: [String(px), String(px)], dayBaseVlm: String(vol / px) })),
      ]
    case 'candleSnapshot': {
      const c = coins.find((x) => x[0] === body.req.coin)
      return Array.from({ length: 72 }, (_, i) => {
        const p = c[4] + ((c[3] - c[4]) * i) / 71 + Math.sin(i / 4) * c[3] * 0.004
        return { t: body.req.startTime + i * 3600_000, T: body.req.startTime + (i + 1) * 3600_000 - 1, s: c[0], i: '1h', o: String(p), c: String(p), h: String(p), l: String(p), v: '1', n: 1 }
      })
    }
    case 'clearinghouseState': {
      const ntl = state.positions.reduce((s, p) => s + p.value, 0)
      const used = state.positions.reduce((s, p) => s + p.margin, 0)
      const ms = { accountValue: String(state.accountValue), totalNtlPos: String(ntl), totalRawUsd: String(state.accountValue), totalMarginUsed: String(used) }
      return {
        marginSummary: ms,
        crossMarginSummary: ms,
        crossMaintenanceMarginUsed: '0',
        withdrawable: String(state.accountValue - used),
        assetPositions: state.positions.map((p) => ({
          type: 'oneWay',
          position: { coin: p.coin, szi: String(p.szi), leverage: { type: 'cross', value: p.lev }, entryPx: String(p.entry), positionValue: String(p.value), unrealizedPnl: '3.21', returnOnEquity: '0.0642', liquidationPx: String(p.entry * 0.82), marginUsed: String(p.margin), maxLeverage: 40, cumFunding: { allTime: '0', sinceOpen: '0', sinceChange: '0' } },
        })),
        time: Date.now(),
      }
    }
    case 'openOrders':
      return []
    case 'maxBuilderFee':
      assert.equal(body.builder.toLowerCase(), BUILDER)
      return state.builderFee
    case 'extraAgents':
      return state.agents
    default:
      throw new Error(`unmocked info ${body.type}`)
  }
}

async function exchange(body) {
  const a = body.action
  state.orders.push(a)
  if (a.type === 'approveBuilderFee') {
    assert.equal((await verifyUserSigned(body, ApproveBuilderFeeTypes)).toLowerCase(), TRADER.toLowerCase(), 'builder fee signed by the trader')
    assert.equal(a.builder.toLowerCase(), BUILDER)
    assert.equal(a.maxFeeRate, '0.05%')
    state.builderFee = 50
    return { status: 'ok', response: { type: 'default' } }
  }
  if (a.type === 'approveAgent') {
    assert.equal((await verifyUserSigned(body, ApproveAgentTypes)).toLowerCase(), TRADER.toLowerCase(), 'agent approved by the trader')
    state.agents = [{ name: a.agentName, address: a.agentAddress, validUntil: Date.now() + 86_400_000 * 180 }]
    return { status: 'ok', response: { type: 'default' } }
  }
  // Everything else is an L1 action, signed by the approved trading key.
  const signer = (await verifyL1(body)).toLowerCase()
  assert.equal(signer, state.agents[0]?.address.toLowerCase(), 'L1 action signed by the approved agent')
  if (a.type === 'updateLeverage') return { status: 'ok', response: { type: 'default' } }
  if (a.type === 'order') {
    const o = a.orders[0]
    assert.deepEqual(a.builder, { b: BUILDER, f: 50 })
    const c = coins[o.a]
    if (o.r) state.positions = state.positions.filter((p) => p.coin !== c[0])
    else {
      const lev = state.orders.filter((x) => x.type === 'updateLeverage').at(-1).leverage
      state.positions.push({ coin: c[0], szi: (o.b ? 1 : -1) * Number(o.s), entry: c[3], value: Number(o.s) * c[3], margin: (Number(o.s) * c[3]) / lev, lev })
    }
    return { status: 'ok', response: { type: 'order', data: { statuses: [{ filled: { totalSz: o.s, avgPx: String(c[3]), oid: 1 } }] } } }
  }
  throw new Error(`unmocked exchange ${a.type}`)
}

// ------------------------------------------------------------ browser
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await ctx.addInitScript(`window.__E2E_ACCOUNT = ${JSON.stringify(TRADER)};\n${shim}`)
await ctx.route(/api\.hyperliquid\.xyz\/(info|exchange)/, async (route) => {
  const body = JSON.parse(route.request().postData())
  try {
    const res = route.request().url().endsWith('/info') ? await info(body) : await exchange(body)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(res) })
  } catch (e) {
    console.error('mock error', e.message)
    state.error = e
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'err', response: e.message }) })
  }
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const shot = (n) => page.screenshot({ path: path.join(out, `hl-${n}.png`), fullPage: true })
const waitText = (t, timeout = 30000) => page.getByText(t, { exact: false }).first().waitFor({ timeout })

try {
  await page.goto(`${url}/#/hyperliquid`)
  await waitText('Powered by Hyperliquid')
  await waitText('$104,250')
  log('markets load without a wallet')
  await page.locator('.hl-mkt', { hasText: 'ETH' }).click()
  await waitText('ETH-PERP')
  await page.locator('.hl-mkt', { hasText: 'BTC' }).click()
  await shot('markets')

  // The injected wallet may already be connected on load.
  const connect = page.getByRole('button', { name: /Connect wallet/ }).first()
  if (await connect.isVisible({ timeout: 3000 }).catch(() => false)) await connect.click()
  const pick = page.getByText('E2E Wallet').first()
  if (await pick.isVisible({ timeout: 5000 }).catch(() => false)) await pick.click()
  await waitText('Enable Hyperliquid trading')
  log('connected, trading not enabled yet')

  await page.getByRole('button', { name: 'Enable trading' }).click()
  await waitText('Hyperliquid trading enabled')
  assert.ifError(state.error)
  assert.deepEqual(state.orders.map((o) => o.type), ['approveBuilderFee', 'approveAgent'])
  log('builder fee and trading key approved, both signed by the trader')

  await page.locator('label.field', { hasText: 'Margin' }).locator('input').fill('100')
  await page.locator('input[type=range]').fill('10')
  await page.getByRole('button', { name: 'Long BTC' }).click()
  await waitText('Long BTC filled')
  assert.ifError(state.error)
  const order = state.orders.find((o) => o.type === 'order')
  assert.equal(order.orders[0].a, 0)
  assert.equal(order.orders[0].b, true)
  assert.equal(order.orders[0].r, false)
  assert.equal(order.orders[0].s, '0.00959') // 100 USDC x 10 / 104250, 5 decimals
  assert.equal(order.orders[0].p, '105290') // mid + 1%, 5 significant figures
  assert.equal(state.orders.find((o) => o.type === 'updateLeverage').leverage, 10)
  log('long filled with the builder fee, signed by the trading key, no wallet popup')
  await page.locator('.positions').getByText('Long').waitFor()
  await shot('position')

  await page.locator('.positions').getByRole('button', { name: 'Close' }).click()
  await waitText('BTC closed')
  assert.ifError(state.error)
  const close = state.orders.filter((o) => o.type === 'order').at(-1).orders[0]
  assert.equal(close.r, true)
  assert.equal(close.b, false)
  assert.equal(close.s, '0.00959')
  await waitText('No open positions on Hyperliquid')
  log('closed with a reduce only order')

  await page.setViewportSize({ width: 390, height: 900 })
  await page.waitForTimeout(500)
  await shot('mobile')
  assert.deepEqual(errors, [])
  console.log('hyperliquid e2e passed')
} catch (e) {
  await shot('failure').catch(() => {})
  console.error('FAILED', e.message, errors)
  process.exitCode = 1
} finally {
  await browser.close()
}
