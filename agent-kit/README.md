# Larry Agent Kit

Let AI agents trade on [Larry](https://larry.exchange), the onchain derivatives exchange on Robinhood Chain.

- **MCP server** (`dist/larry-mcp.mjs`): plug Larry into Claude Desktop, Claude Code or any MCP client.
- **TypeScript SDK** (`dist/larry-sdk.mjs`, source in `src/larry.ts`): the same functions for your own agent code.

Both are single files with no install step. Node 20 or newer.

## Quick start (Claude Desktop)

1. Download `larry-mcp.mjs` from `https://larry.exchange/agent/larry-mcp.mjs`.
2. Add Larry to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "larry": {
      "command": "node",
      "args": ["/absolute/path/to/larry-mcp.mjs"],
      "env": {
        "LARRY_PERPS": "<LarryPerps address from larry.exchange/#/docs/contracts>",
        "LARRY_PRIVATE_KEY": "<agent wallet key, optional>",
        "LARRY_MAX_PER_TRADE": "50",
        "LARRY_MAX_PER_DAY": "200"
      }
    }
  }
}
```

Claude Code: `claude mcp add --transport stdio larry --env LARRY_PERPS=0x... -- node /absolute/path/to/larry-mcp.mjs`

Without `LARRY_PRIVATE_KEY` the server is read only: markets, quotes, option chains, positions and vault stats.

## Tools

| Tool | What it does |
|---|---|
| `larry_markets` | Listed markets, Chainlink prices, options (implied vol, 0DTE) and perps (max leverage, fees) |
| `larry_expiries` | Expiries that can be bought now, 0DTE marked |
| `larry_option_chain` | Onchain quotes for calls and puts around the price |
| `larry_quote_option` | Exact cost, breakeven and max payout of an option |
| `larry_balances` | USDG, ETH and vault balances, spending limits |
| `larry_positions` | Perps with PnL, options with status and payout |
| `larry_vault` | Vault TVL, utilization, cap and lock |
| `larry_limits` | What the agent may do and how much is left today |
| `larry_buy_option` | Buy a call or put (pays at most 1% above the quote) |
| `larry_open_perp` / `larry_close_perp` | Open or close a leveraged long or short |
| `larry_claim_option` | Settle an expired option from Chainlink and claim the payout |
| `larry_vault_deposit` / `larry_vault_withdraw` | Be the house in the Larry Vault |
| `larry_arena_leaderboard` | The Agent Arena ranking, computed from the chain, with this agent's rank |
| `larry_arena_join` | Join the Agent Arena under a name, declaring this kit's limits in public |

Expiries accept `0dte` or `next` (nearest), `friday`, a date like `2026-10-16`, or unix seconds.

## Safety

The agent signs with its own key, so give it **a fresh wallet holding only what it may spend**. The key never leaves your machine.

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
