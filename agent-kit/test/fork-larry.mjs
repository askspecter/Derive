// $LARRY tools against a mainnet fork: the real token and its Pons pool.
// Run `npx hardhat node --port 8546 --fork https://rpc.mainnet.chain.robinhood.com` first.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

const RPC = 'http://127.0.0.1:8546'
const rpc = (method, params = []) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json())
await rpc('evm_mine')
const client = new Client({ name: 'fork', version: '1.0.0' })
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [new URL('../dist/larry-mcp.mjs', import.meta.url).pathname],
  env: { PATH: process.env.PATH, LARRY_RPC_URL: RPC, LARRY_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'larry-f-')), LARRY_MAX_ETH_PER_DAY: '0.005', LARRY_MAX_LARRY_PER_DAY: '1000000' },
}))
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  const text = r.content?.[0]?.text ?? ''
  if (r.isError) return { error: true, text }
  return { error: false, text, data: JSON.parse(text) }
}

const w = (await call('larry_wallet')).data
console.log('agent wallet', w.address)
await rpc('hardhat_setBalance', [w.address, '0x' + (10n ** 16n).toString(16)]) // 0.01 ETH

const before = (await call('larry_burn_stats')).data
console.log('burned before', before.totalBurned)

const buy = await call('larry_buy_larry', { eth: 0.002 })
assert.equal(buy.error, false, buy.text)
console.log('bought ~', buy.data.expectedLarry, 'LARRY')
const held = (await call('larry_wallet')).data.LARRY
assert.ok(held >= buy.data.minLarry, `holds ${held}`)

const burnAmt = Math.floor(held / 2)
const burn = await call('larry_burn_larry', { amount: burnAmt })
assert.equal(burn.error, false, burn.text)
assert.ok(burn.data.totalBurned - before.totalBurned >= burnAmt - 1, JSON.stringify(burn.data))
console.log('burned', burnAmt, 'total now', burn.data.totalBurned)

const pay = await call('larry_pay', { to: '0x000000000000000000000000000000000000bEEF', amount: 100, asset: 'LARRY' })
assert.equal(pay.error, false, pay.text)
console.log('paid 100 LARRY, receipt', pay.data.receipt)

assert.match((await call('larry_buy_larry', { eth: 0.004 })).text, /Daily ETH limit/)
await client.close()
console.log('fork test passed')
