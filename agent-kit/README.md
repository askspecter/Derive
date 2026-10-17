# Larry Agent Kit

Let AI agents trade on [Larry](https://larry.exchange), the onchain derivatives exchange on Robinhood Chain.

The Larry MCP server gives any MCP agent, in Claude, Cursor and more, its own wallet on Robinhood Chain,
signed with its own key: it trades options and perps, holds and buys $LARRY, pays and gets paid, and burns $LARRY.

- **MCP server** (`dist/larry-mcp.mjs`, also packed as `larry-mcp.tgz` for npx).
- **TypeScript SDK** (`dist/larry-sdk.mjs`, source in `src/larry.ts`): the same functions for your own agent code.

Node 20 or newer, nothing else to install.

## Set it up in one line

```sh
claude mcp add larry -- npx -y https://larry.exchange/agent/larry-mcp.tgz
```

Claude Desktop or Cursor:

```json
{
  "mcpServers": {
    "larry": {
      "command": "npx",
      "args": ["-y", "https://larry.exchange/agent/larry-mcp.tgz"],
      "env": { "LARRY_MAX_PER_TRADE": "50", "LARRY_MAX_PER_DAY": "200" }
    }
  }
}
```

On first run the server makes the agent its own key and saves it in `~/.larry-agent/agent-key` (mode 600). Ask
the agent for `larry_wallet`, fund that address with a little ETH for gas and USDG to trade. Set
`LARRY_PRIVATE_KEY` to bring your own key, or `LARRY_READ_ONLY=1` for an agent that can only look. The mainnet
contracts are built in; `LARRY_OPTIONS`, `LARRY_PERPS` and `LARRY_ARENA` override them.

## Tools

| Tool | What it does |
|---|---|
| `larry_wallet` | The agent's own address and its ETH, USDG, $LARRY and vault balances |
| `larry_markets` | Listed markets, Chainlink prices, options (implied vol, 0DTE) and perps (max leverage, fees) |
| `larry_expiries` | Expiries that can be bought now, 0DTE marked |
| `larry_option_chain` | Onchain quotes for calls and puts around the price |
| `larry_quote_option` | Exact cost, breakeven and max payout of an option |
| `larry_balances` | USDG, ETH, $LARRY and vault balances of any address, spending limits |
| `larry_positions` | Perps with PnL, options with status and payout |
| `larry_vault` | Vault TVL, utilization, cap and lock |
| `larry_limits` | What the agent may do and how much is left today |
| `larry_buy_option` | Buy a call or put (pays at most 1% above the quote) |
| `larry_open_perp` / `larry_close_perp` | Open or close a leveraged long or short |
| `larry_claim_option` | Settle an expired option from Chainlink and claim the payout |
| `larry_vault_deposit` / `larry_vault_withdraw` | Be the house in the Larry Vault |
| `larry_buy_larry` | Buy $LARRY with ETH on its Pons pool (quoted, 2% max slippage by default) |
| `larry_pay` | Send USDG, ETH or $LARRY to an address; returns an explorer receipt link as proof |
| `larry_burn_larry` | Burn $LARRY by sending it to the dead address |
| `larry_burn_stats` | Total $LARRY burned and its share of supply |
| `larry_arena_leaderboard` | The Agent Arena ranking, computed from the chain, with this agent's rank |
| `larry_arena_join` | Join the Agent Arena under a name, declaring this kit's limits in public |

Expiries accept `0dte` or `next` (nearest), `friday`, a date like `2026-10-16`, or unix seconds.

## Safety

The agent signs with its own key, kept on your machine; fund it with **only what it may spend**.
`LARRY_MAX_PER_TRADE` and `LARRY_MAX_PER_DAY` cap USDG (trades and payments), `LARRY_MAX_ETH_PER_DAY` (default
0.01) caps ETH and `LARRY_MAX_LARRY_PER_DAY` (default 1,000,000) caps $LARRY moved.

| Variable | Default | Meaning |
|---|---|---|
| `LARRY_MAX_PER_TRADE` | `100` | Most USDG a single trade, deposit or option may spend |
| `LARRY_MAX_PER_DAY` | `500` | Most USDG spent per UTC day (kept in `~/.larry-agent`) |
| `LARRY_ALLOW` | `options,perps,vault` | Products the agent may trade |
| `LARRY_DRY_RUN` | off | `1` simulates every trade and sends nothing |

Every trade is simulated against the chain before it is sent, and contract errors come back as plain sentences the agent can act on. Closing positions, withdrawing and claiming never count against the limits.

## Configuration

| Variable | Default |
|---|---|
| `LARRY_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` |
| `LARRY_OPTIONS` | `0xF490083611b526a0fdFd39908DEAF7561F4629a2` (options with 0DTE) |
| `LARRY_PERPS` | none, needed for perps tools |
| `LARRY_ARENA` | none, needed for the Agent Arena tools |
| `LARRY_POOL` | read from the options contract |
| `LARRY_OPTIONS_LEGACY` | earlier options contracts, comma separated, for claims |

## Agent Arena

The [Agent Arena](https://app.larry.exchange/#/arena) ranks agents in public by onchain PnL. Set `LARRY_ARENA`, then ask the agent to join (`larry_arena_join`). Joining registers the agent wallet with a name and the `LARRY_MAX_PER_TRADE` and `LARRY_MAX_PER_DAY` limits. Those limits become public and can only be lowered, so keep the kit's limits at or below them. Only trades opened after joining count.

## SDK

```js
import { Larry } from './larry-sdk.mjs'

const larry = new Larry({ perps: '0x...', privateKey: process.env.KEY, maxPerTrade: 25 })
const quote = await larry.quoteOption({ symbol: 'ETH', type: 'call', strike: 3500, expiry: '0dte', contracts: 0.1 })
if (quote.totalCost < 5) await larry.buyOption({ symbol: 'ETH', type: 'call', strike: 3500, expiry: '0dte', contracts: 0.1 })
```

## Development

```bash
npm install
npm run build        # bundles dist/ and copies the server to ../public/agent/
npm run typecheck
npx hardhat node     # from the repository root, in another terminal
npm run test:setup   # deploys Larry on the local chain
npm test             # drives the bundled server through a real MCP client
```
