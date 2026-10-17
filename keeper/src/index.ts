// The $LARRY buyback keeper, on Cloudflare: a Durable Object wakes itself every few seconds and triggers
// one small buy on the LarryBuyback contract, which buys $LARRY on the Pons pool and sends it to the dead
// address. It creates its own keeper key on first run and keeps it in its storage; the owner makes that
// address the contract's keeper from the Larry admin page and sends it a little ETH for gas. The ETH
// budget and every limit stay in the contract, so this key can only trigger buys the contract allows.
import { DurableObject } from 'cloudflare:workers'
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatEther, hexToBigInt, http, parseAbi, parseEther, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'

interface Env {
  KEEPER: DurableObjectNamespace<Keeper>
  RPC_URL: string
  BUYBACK: string
  POOL: string
  EVERY_SEC: string
  AMOUNT_ETH: string
  SLIPPAGE_BPS: string
}

const BUYBACK = parseAbi([
  'function keeper() view returns (address)',
  'function paused() view returns (bool)',
  'function leftToday() view returns (uint256)',
  'function maxPerBuy() view returns (uint256)',
  'function allowedTarget(address) view returns (bool)',
  'function buyAndBurn(address target, bytes data, uint256 value, uint256 minOut)',
])
const PONS = parseAbi(['function buy(uint256 ethIn, uint256 minOut, address to) payable returns (uint256)'])

interface Entry {
  t: number
  ok: boolean
  text: string
  hash?: Hex
}

export class Keeper extends DurableObject<Env> {
  private account?: PrivateKeyAccount

  private async me() {
    if (!this.account) {
      let key = await this.ctx.storage.get<Hex>('key')
      if (!key) {
        key = generatePrivateKey()
        await this.ctx.storage.put('key', key)
      }
      this.account = privateKeyToAccount(key)
    }
    return this.account
  }

  private clients() {
    const chain = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [this.env.RPC_URL] } } })
    return { chain, pub: createPublicClient({ chain, transport: http(this.env.RPC_URL) }) }
  }

  /** Starts the loop if it is not already waiting for its next wake up. */
  async ensure() {
    await this.me()
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 1000)
  }

  async alarm() {
    let next = Math.max(3, Number(this.env.EVERY_SEC) || 10)
    try {
      const r = await this.tick()
      if (r.wait) next = Math.max(next, r.wait)
      await this.log(r.entry)
    } catch (e) {
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? String(e)
      await this.log({ t: Date.now(), ok: false, text: msg.slice(0, 200) })
    }
    await this.ctx.storage.setAlarm(Date.now() + next * 1000)
  }

  private async log(e: Entry) {
    const list = (await this.ctx.storage.get<Entry[]>('log')) ?? []
    await this.ctx.storage.put('log', [e, ...list].slice(0, 30))
  }

  /** One buyback. Returns how long to wait before the next one when the pace has to slow down. */
  private async tick(): Promise<{ entry: Entry; wait?: number }> {
    const account = await this.me()
    const { chain, pub } = this.clients()
    const bb = this.env.BUYBACK as Address
    const pool = this.env.POOL as Address
    const c = { address: bb, abi: BUYBACK } as const
    const now = Date.now()
    const [keeper, paused, left, perBuy, allowed, held, gas] = await Promise.all([
      pub.readContract({ ...c, functionName: 'keeper' }),
      pub.readContract({ ...c, functionName: 'paused' }),
      pub.readContract({ ...c, functionName: 'leftToday' }),
      pub.readContract({ ...c, functionName: 'maxPerBuy' }),
      pub.readContract({ ...c, functionName: 'allowedTarget', args: [pool] }),
      pub.getBalance({ address: bb }),
      pub.getBalance({ address: account.address }),
    ])
    const idle = (text: string, wait = 20) => ({ entry: { t: now, ok: false, text }, wait })
    if (keeper.toLowerCase() !== account.address.toLowerCase()) return idle(`Not the keeper yet. Make ${account.address} the keeper on the admin page.`)
    if (paused) return idle('The contract is paused.')
    if (!allowed) return idle('The $LARRY pool is not allowed on the contract. Press Allow the pool on the admin page.')
    if (gas < parseEther('0.00002')) return idle(`Keeper is low on gas (${formatEther(gas)} ETH). Send it a little ETH.`, 120)

    const base = parseEther(this.env.AMOUNT_ETH || '0.00001')
    let value = (base * BigInt(Math.round((0.7 + Math.random() * 0.6) * 1e6))) / 1_000_000n
    for (const cap of [left, perBuy, held]) if (value > cap) value = cap
    if (value <= 0n) return idle(held === 0n ? 'The contract has no ETH left. Fund it.' : 'Daily limit reached. Waiting for midnight UTC.', 300)

    // Spread the day's budget so buys keep going until midnight UTC instead of running out early.
    const secsLeft = (86_400_000 - (now % 86_400_000)) / 1000
    const buysLeft = Number(left) / Number(base)
    const wait = buysLeft > 0 ? secsLeft / buysLeft : undefined

    const q = await pub.call({ account: bb, to: pool, value, data: encodeFunctionData({ abi: PONS, functionName: 'buy', args: [value, 0n, bb] }) })
    const quote = hexToBigInt(q.data!)
    const minOut = (quote * BigInt(10_000 - (Number(this.env.SLIPPAGE_BPS) || 300))) / 10_000n
    const data = encodeFunctionData({ abi: PONS, functionName: 'buy', args: [value, minOut, bb] })
    const { request } = await pub.simulateContract({ ...c, account, functionName: 'buyAndBurn', args: [pool, data, value, minOut] })
    const wallet = createWalletClient({ account, chain, transport: http(this.env.RPC_URL) })
    const hash = await wallet.writeContract(request)
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 20_000 })
    if (r.status !== 'success') return { entry: { t: now, ok: false, text: 'The buy reverted', hash } }
    const burned = Math.round(Number(formatEther(quote))).toLocaleString('en-US')
    return { entry: { t: now, ok: true, text: `${formatEther(value)} ETH bought and burned ~${burned} LARRY`, hash }, wait }
  }

  async status() {
    const account = await this.me()
    const { pub } = this.clients()
    const [gas, keeper] = await Promise.all([
      pub.getBalance({ address: account.address }).catch(() => null),
      pub.readContract({ address: this.env.BUYBACK as Address, abi: BUYBACK, functionName: 'keeper' }).catch(() => null),
    ])
    return {
      keeper: account.address,
      isKeeper: !!keeper && keeper.toLowerCase() === account.address.toLowerCase(),
      gas: gas === null ? null : formatEther(gas),
      nextWake: await this.ctx.storage.getAlarm(),
      log: (await this.ctx.storage.get<Entry[]>('log')) ?? [],
    }
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)

function page(s: Awaited<ReturnType<Keeper['status']>>) {
  const rows = s.log
    .map((e) => `<div class="${e.ok ? 'ok' : 'no'}">${new Date(e.t).toISOString().slice(11, 19)} ${e.ok ? '🔥 ' : ''}${esc(e.text)}${e.hash ? ` <a href="https://robinhoodchain.blockscout.com/tx/${e.hash}" target="_blank">tx ↗</a>` : ''}</div>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="10"><title>Larry burn keeper</title>
<style>body{background:#000;color:#fff;font:15px/1.5 ui-monospace,Menlo,monospace;margin:0;padding:24px 16px;max-width:760px}h1{font-size:20px;color:#5bfcc0;margin:0 0 16px}
.card{border:1px solid #1d2b25;border-radius:14px;padding:16px;margin-bottom:16px;background:#060c09}.k{color:#8a9a93;font-size:12px;letter-spacing:.12em}.addr{word-break:break-all;font-size:16px;margin:6px 0}
.ok{color:#5bfcc0}.no{color:#8a9a93}a{color:#5bfcc0}.pill{display:inline-block;padding:3px 10px;border-radius:99px;border:1px solid currentColor;font-size:12px}</style></head><body>
<h1>$LARRY burn keeper</h1>
<div class="card"><div class="k">KEEPER ADDRESS</div><div class="addr">${s.keeper}</div>
<div>${s.isKeeper ? '<span class="pill ok">ACTIVE KEEPER</span>' : '<span class="pill no">NOT THE KEEPER YET</span>'} &nbsp; gas ${s.gas ?? '?'} ETH</div>
${s.isKeeper ? '' : '<p class="no">Open the Larry admin page, Burn section, paste this address under Cloud keeper and press the button.</p>'}</div>
<div class="card"><div class="k">LATEST</div>${rows || '<div class="no">Starting…</div>'}</div></body></html>`
}

export default {
  async fetch(req: Request, env: Env) {
    const stub = env.KEEPER.get(env.KEEPER.idFromName('main'))
    await stub.ensure()
    const s = await stub.status()
    if (new URL(req.url).pathname === '/status.json') return Response.json(s, { headers: { 'access-control-allow-origin': '*' } })
    return new Response(page(s), { headers: { 'content-type': 'text/html; charset=utf-8' } })
  },
  async scheduled(_: ScheduledController, env: Env) {
    await env.KEEPER.get(env.KEEPER.idFromName('main')).ensure()
  },
} satisfies ExportedHandler<Env>
