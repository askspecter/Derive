# $LARRY buyback and burn bot

Every few seconds the bot buys a small amount of $LARRY on the open market. The swap delivers the tokens
straight to `0x000000000000000000000000000000000000dEaD`, so each buyback is also a burn, in one transaction.
Each one shows on the explorer and on the burn tracker at `larry.exchange/#/burn`.

## Safety

- Run it from **a fresh wallet that holds only the buyback budget** plus a little ETH for gas.
- `BUYBACK_MAX_PER_DAY` caps spending per UTC day. The bot pauses when it is reached and resumes the next day.
- Every swap sets a minimum output from a fresh quote (`BUYBACK_SLIPPAGE_BPS`, 3% by default) and is simulated before it is sent.
- The bot stops buying when the wallet's ETH falls below `BUYBACK_MIN_GAS_ETH`.
- Publish the wallet: set `VITE_LARRY_BUYBACK_WALLET` in Vercel and the burn page links to it.

## Setup

1. Find the DEX. Take any $LARRY buy transaction from the explorer and run:
   ```bash
   node buyback/larry-buyback.mjs detect 0x<txhash>
   ```
   It prints whether the pool is Uniswap V2 or V3 style, the pool and its factory. Set `BUYBACK_DEX` and
   `BUYBACK_ROUTER` (and `BUYBACK_QUOTER` for V3) from the DEX docs.
2. `cp buyback/.env.example buyback/.env` and fill it in.
3. Check everything without sending anything:
   ```bash
   node buyback/larry-buyback.mjs check
   ```
   It shows the route, the wallet balances and how much $LARRY one buy gets right now.
4. Try `BUYBACK_DRY_RUN=1 node buyback/larry-buyback.mjs run` for a minute, then run it for real.

## Keep it running

It needs a computer that stays on, such as a small VPS. With Node 20 and pm2:

```bash
git clone <this repo> && cd <repo> && npm install
cp buyback/.env.example buyback/.env   # fill in
npm i -g pm2
pm2 start buyback/larry-buyback.mjs --name larry-buyback -- run
pm2 save && pm2 startup                # restart after reboots
pm2 logs larry-buyback                 # watch the burns
```

Each line of the log is one burn with its explorer link. `pm2 stop larry-buyback` stops it.

## Costs

At one buy every 10 seconds the bot sends up to 8,640 transactions a day. Each pays gas and the pool fee
(often 0.3%), so tiny buys lose a share of the budget to fees. Watch the first hour of logs before raising the
pace or the budget.

## Tests

`buyback/test/buyback.test.mjs` runs the bot against real Uniswap V2 and V3 contracts on a local chain
(ETH and USDG payments, the daily cap, V3 with the quoter, dry run).
