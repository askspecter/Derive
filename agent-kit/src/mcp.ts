// Larry MCP server: lets any MCP client (Claude, agent frameworks, wallets with agents) read and
// trade on Larry. Read tools always work; trading needs LARRY_PRIVATE_KEY and stays inside the
// spending limits set in the environment.
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import { configFromEnv, Larry, LarryError } from './larry'

const VERSION = '0.1.0'

const INSTRUCTIONS = `Larry is an onchain derivatives exchange on Robinhood Chain (chain id 4663).
Products: options (European calls and puts, cash settled in USDG, Friday expiries plus daily 0DTE expiries at 08:00 UTC on some markets), perpetuals (isolated margin, Chainlink prices) and the Larry Vault (LPs earn from every trade).
Always check larry_markets first, and quote before buying. A bought option can lose at most what was paid for it. Perps can be liquidated.
The Agent Arena ranks agents in public by their onchain PnL. Only join it (larry_arena_join) when the user asks.
Trading tools spend real money from the configured agent wallet and are capped by the limits in larry_limits. Tell the user what a trade costs and its maximum loss before placing it.`

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: e instanceof LarryError ? e.message : `Error: ${(e as Error)?.message ?? String(e)}` }],
})
const run = (fn: () => Promise<unknown>) => fn().then(ok, fail)

const symbol = z.string().describe('Market symbol, for example ETH, BTC, LINK, TSLA, NVDA')
const expiry = z.union([z.string(), z.number()]).describe('"0dte" or "next" for the nearest expiry, "friday", a date like 2026-10-16, or unix seconds')
const optionArgs = {
  symbol,
  type: z.enum(['call', 'put']),
  strike: z.number().positive().describe('Strike price in USD'),
  expiry,
  contracts: z.number().positive().describe('Number of contracts, 1 contract = 1 unit of the underlying'),
}
const READ = { readOnlyHint: true, openWorldHint: true }
const WRITE = { readOnlyHint: false, destructiveHint: true, openWorldHint: true }

export function createServer(larry = new Larry(configFromEnv())) {
  const server = new McpServer({ name: 'larry', version: VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS })

  server.registerTool('larry_markets', { title: 'Markets', description: 'Every listed market on Larry with its Chainlink price and what can be traded: options (implied vol, daily 0DTE expiries) and perps (max leverage, fees).', inputSchema: z.object({}), annotations: READ }, () => run(() => larry.markets()))

  server.registerTool('larry_expiries', { title: 'Option expiries', description: 'Option expiries that can be bought now on a market. zeroDte marks expiries less than a day away.', inputSchema: z.object({ symbol }), annotations: READ }, ({ symbol }) => run(() => larry.expiries(symbol)))

  server.registerTool('larry_option_chain', { title: 'Option chain', description: 'Onchain quotes for calls and puts at strikes around the current price, for one expiry. Prices are the cost of one contract including the fee.', inputSchema: z.object({ symbol, expiry: expiry.optional() }), annotations: READ }, ({ symbol, expiry }) => run(() => larry.optionChain(symbol, expiry ?? '0dte')))

  server.registerTool('larry_quote_option', { title: 'Quote an option', description: 'Exact onchain price for buying an option: premium, fee, total cost, breakeven and maximum payout.', inputSchema: z.object(optionArgs), annotations: READ }, (a) => run(() => larry.quoteOption(a).then(({ raw, ...q }) => q)))

  server.registerTool('larry_balances', { title: 'Balances', description: 'USDG, ETH and Larry Vault balances of the agent wallet, or of any address, plus the agent spending limits.', inputSchema: z.object({ address: z.string().optional().describe('Defaults to the agent wallet') }), annotations: READ }, ({ address }) => run(() => larry.balances(address)))

  server.registerTool('larry_positions', { title: 'Positions', description: 'Open perps (with PnL) and options (with status, payout and whether they can be claimed) of the agent wallet or any address.', inputSchema: z.object({ address: z.string().optional() }), annotations: READ }, ({ address }) => run(() => larry.positions(address)))

  server.registerTool('larry_vault', { title: 'Larry Vault', description: 'Larry Vault stats: total value locked, liquidity reserved for open trades, utilization, deposit cap and lock period.', inputSchema: z.object({}), annotations: READ }, () => run(() => larry.vault()))

  server.registerTool('larry_limits', { title: 'Agent limits', description: 'What this agent may do: allowed products, per trade and daily spending limits, how much is left today, and whether it is in dry run mode.', inputSchema: z.object({}), annotations: READ }, () => run(async () => ({ wallet: larry.account?.address ?? null, readOnly: !larry.account, ...larry.limits() })))

  server.registerTool('larry_buy_option', { title: 'Buy an option', description: 'Buys a call or put from the Larry Vault. Spends up to 1% above the current quote from the agent wallet. The most the position can lose is what it costs.', inputSchema: z.object(optionArgs), annotations: WRITE }, (a) => run(() => larry.buyOption(a)))

  server.registerTool('larry_open_perp', { title: 'Open a perp', description: 'Opens a leveraged long or short with isolated margin. Collateral is in USDG. Fills at the Chainlink price within 0.5%. Can be liquidated if the price moves against it.', inputSchema: z.object({ symbol, side: z.enum(['long', 'short']), collateral: z.number().positive().describe('USDG to post as margin'), leverage: z.number().min(1) }), annotations: WRITE }, (a) => run(() => larry.openPerp(a)))

  server.registerTool('larry_close_perp', { title: 'Close a perp', description: 'Closes an open perp position of the agent wallet at the oracle price.', inputSchema: z.object({ id: z.number().int().nonnegative() }), annotations: WRITE }, ({ id }) => run(() => larry.closePerp(id)))

  server.registerTool('larry_claim_option', { title: 'Claim an option', description: 'Settles an expired option from the first Chainlink price after expiry if nobody has yet, then pays the payout to the owner.', inputSchema: z.object({ id: z.number().int().positive(), contract: z.string().optional().describe('Options contract, for options from an earlier contract') }), annotations: WRITE }, ({ id, contract }) => run(() => larry.claimOption(id, contract)))

  server.registerTool('larry_vault_deposit', { title: 'Deposit into the vault', description: 'Deposits USDG into the Larry Vault for LLP shares. Deposits are locked for the vault lock period.', inputSchema: z.object({ amount: z.number().positive() }), annotations: WRITE }, ({ amount }) => run(() => larry.vaultDeposit(amount)))

  server.registerTool('larry_vault_withdraw', { title: 'Withdraw from the vault', description: 'Withdraws USDG from the Larry Vault once the lock has passed. Use "max" for everything that can be withdrawn now.', inputSchema: z.object({ amount: z.union([z.number().positive(), z.literal('max')]) }), annotations: WRITE }, ({ amount }) => run(() => larry.vaultWithdraw(amount)))

  server.registerTool('larry_arena_leaderboard', { title: 'Agent Arena leaderboard', description: 'The Agent Arena: AI agents trading on Larry ranked by PnL computed from the chain, with their declared limits and whether every trade stayed within them. Includes this agent\'s own rank.', inputSchema: z.object({ top: z.number().int().min(1).max(100).optional().describe('How many agents to list, default 10') }), annotations: READ }, ({ top }) => run(() => larry.arenaLeaderboard(top ?? 10)))

  server.registerTool('larry_arena_join', { title: 'Join the Agent Arena', description: 'Registers the agent wallet in the public Agent Arena under a name, declaring the per trade and daily limits this kit enforces. Limits become public and can only be lowered. Costs gas only, no USDG.', inputSchema: z.object({ name: z.string().min(3).max(24).describe('Public agent name, 3 to 24 letters, digits, spaces, dots, dashes or underscores') }), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } }, ({ name }) => run(() => larry.arenaJoin(name)))

  return server
}

serveStdio(() => createServer())
