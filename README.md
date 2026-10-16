# Larry

**Take the edge back. Derivatives for everyone.**

A [Derive](https://www.derive.xyz/)-style onchain derivatives exchange frontend, built for
[Robinhood Chain](https://docs.robinhood.com/chain/connecting), the Arbitrum Orbit L2 from Robinhood.

*Frontend DEX derivatif ala Derive.xyz di jaringan Robinhood Chain: options, perpetuals, dan vault yield
untuk kripto dan saham tertokenisasi.*

## What's inside

- **Contracts** (`contracts/`): `LarryPool` (ERC4626 liquidity vault, the counterparty), `LarryPerps`
  (isolated margin perpetuals) and `LarryOptions` (European cash settled options, Black Scholes onchain).
  Prices come from Chainlink, collateral is USDG. `LarryArena` is the Agent Arena registry: it holds no funds.
- **App** (`src/`): landing page, Perps, Options, Vault, Portfolio, Stats, Docs and an **Admin** page that
  deploys and configures everything from the admin wallet.
- **Hyperliquid perps** (`/#/hyperliquid`): every Hyperliquid perpetual traded from Larry, powered by Hyperliquid.
  Orders go straight to the Hyperliquid API with Larry's builder code (`VITE_HL_BUILDER`, `VITE_HL_BUILDER_FEE`);
  the builder address needs at least 100 USDC in its Hyperliquid perps account to receive fees.
- **Agent Kit** (`agent-kit/`): MCP server and SDK that let AI agents trade on Larry and join the Agent Arena.
- **Tests**: 16 contract tests, Agent Kit tests over a real MCP client, and a browser end to end test that drives the real UI.

## Network

Larry runs on **Robinhood Chain mainnet** only.

| Network | Chain ID | RPC | Explorer |
| --- | --- | --- | --- |
| Robinhood Chain | 4663 | https://rpc.mainnet.chain.robinhood.com | https://robinhoodchain.blockscout.com |

Chain config lives in `src/config/chains.ts`.

## Asset logos

Logos are bundled in `public/tokens`. ETH uses the Robinhood feather mark; BTC and LINK come from
`cryptocurrency-icons`, and the stock logos (TSLA, NVDA, AAPL) are the official marks from
`simple-icons` on brand-coloured badges. Logos are trademarks of their respective owners.

## Launch checklist

1. Create a **fresh wallet** for the admin (it must have sent no transactions) and fund it with a little ETH
   on Robinhood Chain.
2. Set `VITE_LARRY_ADMIN` to that address and `VITE_REOWN_PROJECT_ID` (see `.env.example`), then deploy the site.
3. Open `/#/admin` with the admin wallet and sign:
   1. Deploy vault (check the USDG address shown, default `0x5fc5…d168` from Paxos' docs)
   2. Deploy perps
   3. Deploy options
   4. Connect both products to the vault
4. In **Markets**, paste each asset's Chainlink feed address for Robinhood Chain (from data.chain.link) and
   list perps and/or options. The page shows the feed's name and latest price before you sign.
5. Seed the vault with liquidity from any wallet on `/#/vaults`.
6. Optional but recommended: transfer ownership to a multisig (Safe) in **Ownership**.

### Turning on 0DTE (daily expiries)

The first options contract only lists Friday expiries. Daily expiries come with the second one, which plugs
into the same vault. On `/#/admin` with the admin wallet, the **Upgrade options for daily expiries** section
walks through it (four signatures):

1. Deploy the new options contract
2. Copy every current options market to it (one transaction)
3. Turn on 0DTE for the markets you pick (crypto by default; stock feeds only update in market hours)
4. Connect it to the vault

Then set `VITE_LARRY_OPTIONS=<new address>` and `VITE_LARRY_OPTIONS_LEGACY=<old address>` in Vercel and
redeploy. Options bought on the old contract stay visible and claimable, and the old contract must stay
connected to the vault until they are all settled. The admin page then offers to pause new buys on it.

Options with less than a day left carry an extra spread (`shortDatedSpreadBps`, 3% by default) on top of the
market spread, set in **Controls**.

### Opening the Agent Arena

The Arena page says "opens soon" until the site knows the arena contract. On `/#/admin`, the **Agent Arena**
section deploys `LarryArena` pointed at the current perps and options contracts (one signature), then shows
the line to set in Vercel: `VITE_LARRY_ARENA=<arena address>`. Redeploy and `/#/arena` shows the leaderboard.

Agents join from their own wallet with the Agent Kit (`LARRY_ARENA=<arena address>`, then `larry_arena_join`).
The leaderboard is computed in the browser from the chain: the agents in the registry, their perps and options
events since the arena was deployed, and current positions. The admin can pause new joins and hide an agent
with an abusive name. If options move to a new contract later, deploy a new arena for it.

**The contracts are not audited.** Keep the deposit cap and open interest caps low until they are.

## Wallet connection (Reown)

Wallets connect through [Reown AppKit](https://docs.reown.com/appkit/react/core/installation) with the wagmi
adapter, locked to Robinhood Chain mainnet. Config lives in `src/lib/reown.ts`.

1. Create a project at https://dashboard.reown.com and copy its Project ID.
2. Copy `.env.example` to `.env` and set `VITE_REOWN_PROJECT_ID`.
3. In the Reown dashboard, add your site domain (and `localhost` for development) to the allowed domains.

On Vercel or Netlify, add `VITE_REOWN_PROJECT_ID` as an environment variable instead of a `.env` file.

## Development

```bash
npm install
npm run dev                 # app on http://localhost:5173
npm run build               # typecheck + production build into dist/

npm run contracts:compile   # solc-js, writes src/contracts/*
npm run chain               # local Hardhat chain with chain id 4663 (keep running)
npm run contracts:test      # contract tests against it
```

Production runs on two hosts from one Vercel project: `larry.exchange` (landing, docs) and
`app.larry.exchange` (trading app, admin). Links and redirects switch hosts at runtime (`src/config/site.ts`);
localhost and `*.vercel.app` previews keep everything on one host. Add both domains to Reown's allowed domains.

Browser end to end test (local chain running):

```bash
node test/e2e/setup.mjs /tmp/e2e.json   # mock USDG and Chainlink feeds
VITE_LARRY_ADMIN=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 VITE_RPC_URL=http://127.0.0.1:8545 npx vite build --outDir /tmp/dist-e2e
npx serve /tmp/dist-e2e -l 4190 &
node test/e2e/ui.cjs http://localhost:4190 /tmp/e2e.json /tmp
```

The build is a static site (hash routing, relative base), so `dist/` can be hosted on Vercel, Netlify,
GitHub Pages, IPFS, etc.

Larry is an independent project and is not affiliated with Robinhood Markets, Inc.
