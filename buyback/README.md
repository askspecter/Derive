# $LARRY buyback and burn

Every few seconds a small amount of $LARRY is bought on the open market and sent to
`0x000000000000000000000000000000000000dEaD` in the same transaction. Each one shows on the explorer and on the
burn tracker at `larry.exchange/#/burn`.

Two parts:

- **`contracts/LarryBuyback.sol`**: holds the ETH budget. $LARRY trades in a Uniswap V4 ETH pool, so on each trigger
  the contract swaps on the V4 PoolManager itself and has it pay the $LARRY straight to the dead address, checking
  the minimum output. (It can also swap through an allowed router or the 0x API and then burn all it holds.) Caps per
  buy and per day are enforced onchain, it only ever spends ETH (it never approves tokens), and the owner can
  pause it or withdraw the ETH at any time. Anyone can burn $LARRY that lands in it.
- **`buyback/larry-buyback.mjs`**: the keeper bot. Every few seconds it quotes the buy (by simulating it) and calls
  the contract. The keeper wallet only pays gas.

## No server: run it from the admin page

On `app.larry.exchange/#/admin`, section *$LARRY buyback and burn*:

1. **Uniswap V4 pool**: paste the hash of any $LARRY buy into *Find it from a $LARRY buy*, press Find, then Set pool.
2. **Run buybacks from this browser**: create a keeper key, then *Make this browser the keeper* (one transaction to
   set it, one to send it 0.001 ETH for gas).
3. Set the interval and the ETH per buy, and press **Start buybacks**. Every buy shows in the log with its
   transaction. It runs while the tab stays open; on a phone keep the screen on.

The keeper key only lives in that browser and can only trigger buys within the contract's limits; the ETH budget
stays in the contract.

## Setup with a server

1. **Deploy the contract.** On `app.larry.exchange/#/admin`, section *$LARRY buyback and burn*: enter the keeper
   wallet (a fresh wallet for the bot), the max per buy and per day in ETH, and press Deploy. Then **Fund** it
   with the ETH budget.
2. **Find the V4 pool.** Run `node buyback/larry-buyback.mjs detect 0x<any $LARRY buy tx>`. It prints the
   PoolManager, fee, tick spacing and hooks. Enter them under *Uniswap V4 pool* on the admin page and press Set pool.
3. **Configure the bot.** `cp buyback/.env.example buyback/.env` and fill in `BUYBACK_PRIVATE_KEY` (the keeper) and
   `BUYBACK_CONTRACT`. Send the keeper a little ETH for gas.
4. **Check.** `node buyback/larry-buyback.mjs check` prints the contract, its budget, the pool and a live quote.
5. **Try a dry run**, then start it:
   ```bash
   BUYBACK_DRY_RUN=1 node buyback/larry-buyback.mjs run
   node buyback/larry-buyback.mjs run
   ```
6. Set `VITE_LARRY_BUYBACK=<contract>` in Vercel so the burn page shows the contract's live stats.

## Keep it running

It needs a computer that stays on, such as a small VPS. With Node 20 and pm2:

```bash
git clone <this repo> && cd <repo> && npm install
cp buyback/.env.example buyback/.env   # fill in
npm i -g pm2
pm2 start buyback/larry-buyback.mjs --name larry-buyback -- run
pm2 save && pm2 startup                # restart after reboots
pm2 logs larry-buyback                 # each line is one burn with its explorer link
```

`pm2 stop larry-buyback` stops the bot; *Pause* on the admin page stops the contract itself.

## Costs

At one buy every 10 seconds there are up to 8,640 buys a day. Gas on Robinhood Chain is tiny, but each swap pays
the pool fee and any 0x fee, so very small buys lose a share to fees. The contract's daily cap is the real limit:
the bot pauses when it is reached and resumes the next UTC day.

## Without a contract

The bot can also swap from its own wallet straight to the dead address on a V2 or V3 router (`BUYBACK_ROUTE=v2`,
`BUYBACK_ROUTER=...`, no `BUYBACK_CONTRACT`), paying ETH or a token. `detect <txhash>` inspects a $LARRY buy to
find which pool it used.

## Tests

`buyback/test/buyback.test.mjs` runs the contract and the bot against real Uniswap V2 and V3 contracts on a local
chain, including the 0x route against a mock 0x API: caps, minimum output, allowed targets, pause, withdraw.
