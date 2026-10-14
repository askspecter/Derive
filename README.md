# Larry — Derivatives on Robinhood Chain

A [Derive](https://www.derive.xyz/)-style onchain derivatives exchange frontend, built for
[Robinhood Chain](https://docs.robinhood.com/chain/connecting), the Arbitrum Orbit L2 from Robinhood.

*Frontend DEX derivatif ala Derive.xyz di jaringan Robinhood Chain: options, perpetuals, dan vault yield
untuk kripto dan saham tertokenisasi.*

## Features

- **Landing page**: hero, live ticker, market list, feature grid, top vaults
- **Options**: options chain (calls/puts, bid/ask, IV smile, delta) priced with Black-Scholes, weekly and
  monthly expiries, an order ticket with greeks, breakeven and margin
- **Perps**: candlestick chart, order book, long/short up to 20x, liquidation price estimate
- **Vaults**: covered call, cash-secured put, principal protected, basis and iron condor strategies
- **Portfolio**: equity, free margin, unrealized PnL, open positions, vault positions, trade history
- **Stats**: protocol metrics and Robinhood Chain network details
- **Wallet**: EIP-1193 connect (Robinhood Wallet, MetaMask, …) with automatic switch/add of Robinhood Chain
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
