# $LARRY burn keeper (Cloudflare)

Runs the $LARRY buyback and burn around the clock, with no server and no browser tab open. A Cloudflare
Durable Object wakes every few seconds and triggers one small buy on the LarryBuyback contract, which buys
$LARRY on the Pons pool and sends it to the dead address. Free on the Cloudflare Workers free plan.

The keeper makes its own key the first time it runs and keeps it in Cloudflare storage. Nobody pastes a key
anywhere. All money and limits stay in the contract: the key can only trigger buys the contract allows, and
the owner can swap the keeper or pause at any time.

## Set up (about 5 minutes)

1. Cloudflare dashboard, Workers & Pages, Create, Import a repository. Pick `askspecter/derive`, the
   branch the site deploys from, and set the root directory to `keeper`. Deploy.
2. Open the worker's URL (`https://larry-burn-keeper.<you>.workers.dev`). It shows the keeper address.
3. Larry admin page, Burn section, Cloud keeper: paste that address, press **Make it the keeper and send gas**.

That's it. The worker page shows every buy, refreshes on its own, and `/status.json` returns the same as JSON.

## Pace

`wrangler.jsonc` vars: `EVERY_SEC` (fastest pace, 10), `AMOUNT_ETH` (per buy, 0.00001, varies by up to 30%),
`SLIPPAGE_BPS` (300). The keeper slows down on its own so the contract's daily ETH limit lasts until midnight
UTC. With a 0.02 ETH daily limit and 0.00001 ETH buys that is about one buy every 45 seconds; raise the
daily limit on the admin page to buy every 10 seconds all day (about 0.09 ETH a day).

## Test locally

`npm install`, then `npx wrangler dev --var RPC_URL:http://127.0.0.1:8546` against a Hardhat mainnet fork.
