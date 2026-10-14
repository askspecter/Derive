# Larry

**Take the edge back. Derivatives for everyone.**

A [Derive](https://www.derive.xyz/)-style onchain derivatives exchange frontend, built for
[Robinhood Chain](https://docs.robinhood.com/chain/connecting), the Arbitrum Orbit L2 from Robinhood.

*Frontend DEX derivatif ala Derive.xyz di jaringan Robinhood Chain: options, perpetuals, dan vault yield
untuk kripto dan saham tertokenisasi.*

## Features

- **Landing page**: brand hero, markets with live sparklines, products, vaults
- **Docs**: built in documentation at `#/docs` with search, 12 chapters and previous/next navigation
- **Options**: options chain (calls/puts, bid/ask, IV smile, delta) priced with Black-Scholes, weekly and
  monthly expiries, an order ticket with greeks, breakeven and margin
- **Perps**: candlestick chart, order book, long/short up to 20x, liquidation price estimate
- **Vaults**: covered call, cash-secured put, principal protected, basis and iron condor strategies
- **Portfolio**: equity, free margin, unrealized PnL, open positions, vault positions, trade history
- **Stats**: protocol metrics and Robinhood Chain network details
- **Wallet**: Reown AppKit modal (browser wallets and WalletConnect QR) locked to Robinhood Chain
- Markets for crypto (ETH, BTC, SOL) and tokenized stocks (HOOD, TSLA, NVDA, AAPL)

## Network

Larry runs on **Robinhood Chain mainnet** only.

| Network | Chain ID | RPC | Explorer |
| --- | --- | --- | --- |
| Robinhood Chain | 4663 | https://rpc.mainnet.chain.robinhood.com | https://robinhoodchain.blockscout.com |

Chain config lives in `src/config/chains.ts`.

## Asset logos

Logos are bundled in `public/tokens`. ETH uses the Robinhood feather mark; BTC and SOL come from
`cryptocurrency-icons`, and the stock logos (HOOD, TSLA, NVDA, AAPL) are the official marks from
`simple-icons` on brand-coloured badges. Logos are trademarks of their respective owners.

## Status

This is a frontend. Prices come from a simulated oracle (`src/lib/market.tsx`) and trades are **paper
positions** stored in `localStorage` per wallet address (`src/lib/account.tsx`). To go live, deploy the
matching contracts (margin accounts, option/perp settlement, vaults) on Robinhood Chain and an oracle
feed, then replace those two modules with contract reads/writes.

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
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview
```

The build is a static site (hash routing, relative base), so `dist/` can be hosted on Vercel, Netlify,
GitHub Pages, IPFS, etc.

Larry is an independent project and is not affiliated with Robinhood Markets, Inc.
