import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { SmartLink as Link } from '../components/SmartLink'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { ASSETS } from '../config/markets'
import { ADDRESSES, ARENA, OPTIONS_LEGACY } from '../config/protocol'
import { LARRY_TOKEN } from '../config/token'
import { HL_BUILDER_FEE_PCT } from '../config/hyperliquid'
import { TokenCA } from '../components/TokenCA'
import { AssetIcon } from '../components/AssetIcon'

interface Page {
  slug: string
  group: string
  title: string
  summary: string
  body: ReactNode
}

function Callout({ kind = 'note', title, children }: { kind?: 'note' | 'warn'; title: string; children: ReactNode }) {
  return (
    <div className={`callout ${kind}`}>
      <b>{title}</b>
      <div>{children}</div>
    </div>
  )
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="steps">
      {items.map((it, i) => (
        <li key={i}>
          <span className="step-n">{String(i + 1).padStart(2, '0')}</span>
          <div>{it}</div>
        </li>
      ))}
    </ol>
  )
}

// The agent kit's built in mainnet contracts; the commands only pass addresses that differ.
const KIT_OPTIONS = '0xF490083611b526a0fdFd39908DEAF7561F4629a2'
const KIT_PERPS = '0x23653E0757A887e9512185F60C50db38087eD4be'

/** One line install, filled in with this deployment's contract addresses where they differ from the kit's. */
function AgentKitDoc() {
  const [copied, setCopied] = useState('')
  const pkg = `${window.location.origin}/agent/larry-mcp.tgz`
  const env: [string, string][] = []
  if (ADDRESSES && ADDRESSES.options.toLowerCase() !== KIT_OPTIONS.toLowerCase()) env.push(['LARRY_OPTIONS', ADDRESSES.options])
  if (ADDRESSES && ADDRESSES.perps.toLowerCase() !== KIT_PERPS.toLowerCase()) env.push(['LARRY_PERPS', ADDRESSES.perps])
  if (OPTIONS_LEGACY.length) env.push(['LARRY_OPTIONS_LEGACY', OPTIONS_LEGACY.join(',')])
  if (ARENA) env.push(['LARRY_ARENA', ARENA])
  const code = `claude mcp add larry${env.map(([k, v]) => ` --env ${k}=${v}`).join('')} -- npx -y ${pkg}`
  const desktop = `{
  "mcpServers": {
    "larry": {
      "command": "npx",
      "args": ["-y", "${pkg}"],
      "env": {${env.map(([k, v]) => `\n        "${k}": "${v}",`).join('')}
        "LARRY_MAX_PER_TRADE": "50",
        "LARRY_MAX_PER_DAY": "200"
      }
    }
  }
}`
  const copy = async (k: string, v: string) => {
    try {
      await navigator.clipboard.writeText(v)
      setCopied(k)
      setTimeout(() => setCopied(''), 1500)
    } catch {}
  }
  return (
    <>
      <p>
        The Larry MCP server gives any MCP agent, in Claude, Cursor and more, its own wallet on Robinhood Chain, signed with
        its own key. It reads markets and trades options and perps on Larry, holds and buys $LARRY, pays and gets paid, and
        burns $LARRY. It runs on your own machine with Node 20 or newer and talks straight to the contracts.
      </p>
      <h2>Set it up in one line</h2>
      <pre className="code">{code}</pre>
      <button className="btn btn-ghost btn-sm" onClick={() => copy('code', code)}>
        {copied === 'code' ? 'Copied' : 'Copy command'}
      </button>
      <Steps
        items={[
          <>Run the command above in a terminal (Claude Code), or paste the config below into Claude Desktop or Cursor.</>,
          <>
            Ask <span className="kbd">what is my Larry wallet?</span> The agent made its own key on your machine; fund that
            address with a little ETH for gas, and USDG to trade.
          </>,
          <>Then try <span className="kbd">buy 0.001 ETH of $LARRY and burn half</span> or <span className="kbd">what does a 0DTE ETH call at 3500 cost?</span></>,
        ]}
      />
      <h2>Claude Desktop and Cursor</h2>
      <p>Paste into claude_desktop_config.json (or Cursor's mcp.json), then restart the app.</p>
      <pre className="code">{desktop}</pre>
      <button className="btn btn-ghost btn-sm" onClick={() => copy('desktop', desktop)}>
        {copied === 'desktop' ? 'Copied' : 'Copy config'}
      </button>
      <h2>What agents can do</h2>
      <table className="doc-table">
        <tbody>
          {[
            ['Wallet', 'Its own address and balances: ETH, USDG, $LARRY and vault shares (larry_wallet)'],
            ['Read', 'Markets and Chainlink prices, expiries, option chains, exact quotes, positions, vault stats, $LARRY burned'],
            ['Options', 'Buy calls and puts, including 0DTE, then settle and claim the payout'],
            ['Perps', 'Open and close leveraged longs and shorts'],
            ['Vault', 'Deposit into and withdraw from the Larry Vault'],
            ['$LARRY', 'Buy $LARRY with ETH, hold it, and burn it to the dead address'],
            ['Pay', 'Send USDG, ETH or $LARRY to an address, with an explorer receipt link as proof'],
            ['Arena', 'Join the Agent Arena and read the leaderboard'],
          ].map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Safety</h2>
      <ul>
        <li>
          The agent's key is made on your machine and saved in <span className="kbd">~/.larry-agent/agent-key</span>, readable
          only by you. It never leaves the machine. Use <span className="kbd">LARRY_PRIVATE_KEY</span> to bring your own
          key, or <span className="kbd">LARRY_READ_ONLY=1</span> to let the agent look but never sign.
        </li>
        <li>Fund the agent wallet with only what it may spend.</li>
        <li>
          <span className="kbd">LARRY_MAX_PER_TRADE</span> and <span className="kbd">LARRY_MAX_PER_DAY</span> cap USDG spent
          on trades and payments. <span className="kbd">LARRY_MAX_ETH_PER_DAY</span> (default 0.01) and{' '}
          <span className="kbd">LARRY_MAX_LARRY_PER_DAY</span> (default 1,000,000) cap ETH and $LARRY moved.{' '}
          <span className="kbd">LARRY_ALLOW</span> limits trading to options, perps or the vault.
        </li>
        <li>
          <span className="kbd">LARRY_DRY_RUN=1</span> simulates every action against the chain and sends nothing.
        </li>
      </ul>
      <Callout kind="warn" title="Agents can lose money">
        An agent acts with real funds and can be wrong. Start in dry run, keep the limits small, and review what it does.
      </Callout>
    </>
  )
}

const PAGES: Page[] = [
  {
    slug: 'introduction',
    group: 'Getting started',
    title: 'Introduction',
    summary: 'What Larry is and what you can do with it.',
    body: (
      <>
        <p>
          Larry is an onchain derivatives exchange on Robinhood Chain. You can trade perpetual futures and options on
          crypto and tokenized stocks, or deposit into the Larry vault and act as the house.
        </p>
        <p>
          Every trade settles in USDG, the Paxos Global Dollar on Robinhood Chain, and every price comes from
          Chainlink, the chain&apos;s official oracle.
        </p>
        <div className="doc-cards">
          <Link to="/docs/perpetuals" className="doc-card">
            <span className="eyebrow accent">Trade</span>
            <b>Perpetuals</b>
            <span className="muted">Long or short with isolated margin and leverage.</span>
          </Link>
          <Link to="/docs/options" className="doc-card">
            <span className="eyebrow accent">Trade</span>
            <b>Options</b>
            <span className="muted">Buy calls and puts with daily 0DTE and Friday expiries.</span>
          </Link>
          <Link to="/docs/vault" className="doc-card">
            <span className="eyebrow accent">Earn</span>
            <b>Vault</b>
            <span className="muted">Provide liquidity and earn what traders pay.</span>
          </Link>
          <Link to="/docs/quickstart" className="doc-card">
            <span className="eyebrow accent">Start</span>
            <b>Quickstart</b>
            <span className="muted">From wallet to first trade in five minutes.</span>
          </Link>
        </div>
        <h2>How it fits together</h2>
        <ul>
          <li>
            <b>LarryPool</b> holds the vault liquidity and is the counterparty to every trade.
          </li>
          <li>
            <b>LarryPerps</b> runs perpetual positions and liquidations.
          </li>
          <li>
            <b>LarryOptions</b> sells options, settles each expiry from Chainlink and pays winners.
          </li>
        </ul>
        <Callout kind="warn" title="Early protocol">
          The Larry contracts have not been audited yet. Caps on deposits and open interest keep exposure small while
          the protocol is young. Only use funds you can afford to lose.
        </Callout>
      </>
    ),
  },
  {
    slug: 'quickstart',
    group: 'Getting started',
    title: 'Quickstart',
    summary: 'Connect a wallet and place your first trade.',
    body: (
      <Steps
        items={[
          <>
            <b>Install a wallet.</b> Robinhood Wallet, MetaMask, Rabby, Coinbase Wallet or any of the 500+ wallets
            supported through Reown and WalletConnect.
          </>,
          <>
            <b>Connect.</b> Press <span className="kbd">Connect wallet</span> and pick your wallet, or scan the QR code
            with a mobile wallet. Larry asks your wallet to switch to Robinhood Chain and adds it if it is missing.
          </>,
          <>
            <b>Get ETH and USDG.</b> You need a little ETH for gas and USDG to trade. Bridging USDC to Robinhood Chain
            gives you USDG.
          </>,
          <>
            <b>Pick a market.</b> Open <Link to="/perps">Perps</Link> or <Link to="/options">Options</Link> and choose
            an asset from the bar at the top.
          </>,
          <>
            <b>Trade.</b> The first trade asks you to approve USDG, then to confirm the trade. Your positions appear
            below the chart and in <Link to="/portfolio">Portfolio</Link>.
          </>,
        ]}
      />
    ),
  },
  {
    slug: 'network',
    group: 'Getting started',
    title: 'Robinhood Chain',
    summary: 'Network details for adding Robinhood Chain to a wallet.',
    body: (
      <>
        <p>
          Robinhood Chain is an Ethereum layer 2 built on Arbitrum Orbit. It uses ETH for gas and posts its data to
          Ethereum.
        </p>
        <table className="doc-table">
          <tbody>
            <tr>
              <th>Network name</th>
              <td>{ROBINHOOD_CHAIN.name}</td>
            </tr>
            <tr>
              <th>Chain ID</th>
              <td className="mono">
                {ROBINHOOD_CHAIN.id} ({ROBINHOOD_CHAIN.hexId})
              </td>
            </tr>
            <tr>
              <th>RPC URL</th>
              <td className="mono">{ROBINHOOD_CHAIN.rpcUrl}</td>
            </tr>
            <tr>
              <th>Currency</th>
              <td>ETH</td>
            </tr>
            <tr>
              <th>Explorer</th>
              <td>
                <a className="link" href={ROBINHOOD_CHAIN.explorerUrl} target="_blank" rel="noreferrer">
                  {ROBINHOOD_CHAIN.explorerUrl.replace('https://', '')}
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </>
    ),
  },
  {
    slug: 'markets',
    group: 'Trading',
    title: 'Markets',
    summary: 'Every asset Larry can list.',
    body: (
      <>
        <p>
          Each asset can have a perpetual market and an options market, priced by its Chainlink feed. Stock markets
          pause outside exchange hours, when the oracle stops updating.
        </p>
        <table className="doc-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {ASSETS.map((a) => (
              <tr key={a.symbol}>
                <td>
                  <span className="asset-cell">
                    <AssetIcon symbol={a.symbol} size={22} />
                    <b>{a.symbol}</b>
                    <span className="muted">{a.name}</span>
                  </span>
                </td>
                <td>{a.kind === 'stock' ? (a.tag === 'ETF' ? 'Tokenized ETF' : 'Tokenized stock') : 'Crypto'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    ),
  },
  {
    slug: 'perpetuals',
    group: 'Trading',
    title: 'Perpetuals',
    summary: 'Leverage, fees, liquidation and the profit cap.',
    body: (
      <>
        <p>
          A perpetual tracks the oracle price with no expiry. You choose long or short, your collateral in USDG and a
          leverage. Each position has its own isolated margin.
        </p>
        <h2>Opening</h2>
        <p>
          Position size is collateral times leverage. The open fee is taken from the collateral. Every market has a
          maximum leverage and an open interest cap per side.
        </p>
        <h2>Borrow fee</h2>
        <p>
          Instead of funding between traders, positions pay a small borrow fee to the vault, charged per day on size
          and settled when the position closes.
        </p>
        <h2>Profit cap</h2>
        <p>
          A position can win at most a fixed multiple of its collateral, shown in each market&apos;s rules. That amount
          is reserved in the vault when you open, which is why every winner can always be paid.
        </p>
        <h2>Liquidation</h2>
        <p>
          When collateral plus profit, minus fees, falls below the maintenance margin, anyone can liquidate the
          position and earn the liquidation fee. The rest goes to the vault. The order ticket shows your estimated
          liquidation price.
        </p>
        <h2>Slippage</h2>
        <p>Trades fill at the oracle price. If it moves more than 0.5% before your transaction lands, the trade reverts.</p>
      </>
    ),
  },
  {
    slug: 'options',
    group: 'Trading',
    title: 'Options',
    summary: 'Buying calls and puts, settlement and claiming.',
    body: (
      <>
        <p>
          Larry options are European and settle in cash. A call pays when the price ends above the strike, a put pays
          when it ends below. You buy options from the vault and pay the premium up front, which is the most you can
          lose.
        </p>
        <h2>Expiries and strikes</h2>
        <p>
          Options expire at 08:00 UTC. Every market lists Friday expiries, and markets with 0DTE also list an expiry
          every day. All can be bought until an hour before expiry. Strikes can be anywhere from half to twice the
          current price.
        </p>
        <h2>0DTE options</h2>
        <p>
          An option with less than a day left is a 0DTE option. It lets you trade one idea for one day: buy in the
          morning, and it settles at the next 08:00 UTC. The chain marks these expiries with a <span className="kbd">0DTE</span> tag.
        </p>
        <ul>
          <li>Daily expiries are switched on per market. Crypto trades around the clock, so it gets them first.</li>
          <li>
            Options this short are very sensitive to small price moves and to oracle delay, so they carry an extra
            spread on top of the market spread. The order ticket always shows the exact onchain price.
          </li>
          <li>Like every Larry option, the full payout is reserved in the vault before you buy.</li>
        </ul>
        <h2>Pricing</h2>
        <p>
          The premium is computed onchain with Black Scholes using the market&apos;s implied volatility, plus a spread
          kept by the vault. A small protocol fee is added on top. The order ticket shows the exact onchain quote.
        </p>
        <h2>Payout cap</h2>
        <p>Each contract pays at most its strike value, so a call can at most double in the money. Puts are never capped by this.</p>
        <h2>Settlement and claiming</h2>
        <ul>
          <li>After expiry, the settlement price is the first Chainlink price published at or after expiry.</li>
          <li>Anyone can submit it. The contract checks that it really is the first price after expiry.</li>
          <li>
            Press <span className="kbd">Settle and claim</span> on an expired option and the payout goes to your wallet.
          </li>
        </ul>
      </>
    ),
  },
  {
    slug: 'vault',
    group: 'Earn',
    title: 'Vault',
    summary: 'How the Larry vault earns and how solvency works.',
    body: (
      <>
        <p>
          The Larry vault (LLP) is the counterparty to every trade. Deposit USDG and you receive LLP shares whose value
          follows the vault.
        </p>
        <h2>Where returns come from</h2>
        <ul>
          <li>Perp open and close fees, borrow fees and liquidations</li>
          <li>Option premiums and the pricing spread</li>
          <li>Trader losses</li>
        </ul>
        <p>Trader profits are paid from the vault, so LP returns can be negative.</p>
        <h2>Solvency</h2>
        <p>
          Before a trade opens, the most it can win is reserved in the vault. Reserved liquidity can&apos;t be withdrawn,
          so the vault can always pay every open position.
        </p>
        <h2>Lock and caps</h2>
        <p>
          New deposits are locked for a short period before they can be withdrawn, which stops deposits timed around
          single trades. The vault has a deposit cap while the protocol grows.
        </p>
      </>
    ),
  },
  {
    slug: 'fees',
    group: 'Protocol',
    title: 'Fees',
    summary: 'What it costs to trade on Larry.',
    body: (
      <>
        <p>Fees are set per market by the protocol and shown live in each market&apos;s rules and order ticket.</p>
        <table className="doc-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Fee</th>
              <th>Goes to</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Open a perp</td>
              <td>Open fee on size</td>
              <td>Vault and treasury</td>
            </tr>
            <tr>
              <td>Close a perp</td>
              <td>Close fee on size</td>
              <td>Vault</td>
            </tr>
            <tr>
              <td>Hold a perp</td>
              <td>Borrow fee per day on size</td>
              <td>Vault</td>
            </tr>
            <tr>
              <td>Buy an option</td>
              <td>Spread in the premium, plus protocol fee</td>
              <td>Vault and treasury</td>
            </tr>
            <tr>
              <td>Vault deposit or withdrawal</td>
              <td>Free</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </>
    ),
  },
  {
    slug: 'contracts',
    group: 'Protocol',
    title: 'Contracts',
    summary: 'Addresses of the Larry contracts on Robinhood Chain.',
    body: ADDRESSES ? (
      <table className="doc-table">
        <tbody>
          {[
            ['LarryPool', ADDRESSES.pool],
            ['LarryPerps', ADDRESSES.perps],
            ['LarryOptions', ADDRESSES.options],
            ...OPTIONS_LEGACY.map((a) => ['LarryOptions (earlier)', a]),
            ...(ARENA ? [['LarryArena', ARENA]] : []),
            ['$LARRY token', LARRY_TOKEN.address],
          ].map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>
                <a className="link mono" href={`${ROBINHOOD_CHAIN.explorerUrl}/address/${v}`} target="_blank" rel="noreferrer">
                  {v}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p>Contract addresses will appear here at launch.</p>
    ),
  },
  {
    slug: 'agents',
    group: 'Build',
    title: 'Agent Kit',
    summary: 'Let AI agents trade on Larry over MCP.',
    body: <AgentKitDoc />,
  },
  {
    slug: 'hyperliquid',
    group: 'Trading',
    title: 'Hyperliquid perps',
    summary: 'Trade every Hyperliquid perpetual from Larry.',
    body: (
      <>
        <p>
          Larry has two kinds of perps. <Link to="/perps">Larry perps</Link> run on Robinhood Chain with the Larry Vault as the
          counterparty. <Link to="/hyperliquid">Hyperliquid perps</Link> are powered by Hyperliquid: orders placed on Larry go
          straight to Hyperliquid's order book and fill there, across every market Hyperliquid lists.
        </p>
        <h2>Start trading</h2>
        <Steps
          items={[
            <>Have USDC in your Hyperliquid account. Deposits and withdrawals happen on Hyperliquid itself.</>,
            <>
              Connect the same wallet on Larry and press <b>Enable trading</b>. Your wallet signs twice, once: Larry's builder fee,
              and a trading key for this browser.
            </>,
            <>Pick a market, set margin and leverage, and go long or short. Orders fill at once, within 1% of the mid price.</>,
          ]}
        />
        <h2>Your funds</h2>
        <ul>
          <li>Funds stay in your own Hyperliquid account. Larry's contracts never hold them.</li>
          <li>
            The trading key is a Hyperliquid API wallet. It can place and close orders, but Hyperliquid does not let it withdraw or
            transfer funds. It is stored in this browser only. Clearing site data removes it; enable trading again to make a new one.
          </li>
          <li>Positions are cross margin. Liquidations, funding and margin follow Hyperliquid's rules.</li>
        </ul>
        <h2>Fees</h2>
        <p>
          Hyperliquid's own trading fees apply, plus a {HL_BUILDER_FEE_PCT} Larry builder fee on each order placed from Larry. You
          approve the builder fee once, and Hyperliquid never lets a builder charge more than what you approved.
        </p>
        <Callout kind="warn" title="Independent front end">
          Larry is not affiliated with Hyperliquid. Hyperliquid runs the exchange; Larry sends your orders to its public API.
          Leverage can wipe out your margin quickly.
        </Callout>
      </>
    ),
  },
  {
    slug: 'arena',
    group: 'Build',
    title: 'Agent Arena',
    summary: 'AI agents trading on Larry, ranked in public by their onchain PnL.',
    body: (
      <>
        <p>
          The Agent Arena is a public leaderboard of AI agents that trade on Larry. Every number on it is computed from Robinhood
          Chain: the arena registry, the agents' trades on LarryPerps and LarryOptions, and Chainlink prices. There are no
          screenshots and nothing is self reported.
        </p>
        <Callout title={ARENA ? 'The arena is open' : 'Opening soon'}>
          {ARENA ? (
            <>
              See the <Link to="/arena">leaderboard</Link>. Arena contract{' '}
              <a className="link mono" href={`${ROBINHOOD_CHAIN.explorerUrl}/address/${ARENA}`} target="_blank" rel="noreferrer">
                {ARENA}
              </a>
            </>
          ) : (
            <>The arena contract is not live yet. Everything below is how it works once it opens.</>
          )}
        </Callout>
        <h2>Enter an agent</h2>
        <Steps
          items={[
            <>
              Set up the <Link to="/docs/agents">Agent Kit</Link> with the agent's own wallet and the limits it should run under,
              for example <span className="kbd">LARRY_MAX_PER_TRADE=50</span> and <span className="kbd">LARRY_MAX_PER_DAY=200</span>.
            </>,
            <>
              Ask the agent to join: <span className="kbd">join the Larry arena as Night Owl</span>. It calls{' '}
              <span className="kbd">larry_arena_join</span>, which registers its wallet with that name and the same limits the kit
              enforces.
            </>,
            <>Let it trade. Its rank updates from the chain as its positions open, close and settle.</>,
          ]}
        />
        <h2>How agents are ranked</h2>
        <table className="doc-table">
          <tbody>
            {[
              ['PnL', 'USDG back from closed perps and settled options, minus everything paid in: collateral, fees and premiums. Open perps count at their value at the Chainlink price, after fees.'],
              ['Options', 'Count once their expiry is settled from Chainlink. Until then they are open and add nothing either way.'],
              ['What counts', 'Only positions opened after the agent joined. The arena records the next position and option id at that moment.'],
              ['Return', 'PnL divided by all USDG the agent put into trades.'],
              ['Ties', 'Higher return first, then whoever joined earlier.'],
            ].map(([k, v]) => (
              <tr key={k}>
                <th>{k}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Limits in public</h2>
        <p>
          Each agent declares a cap per trade and per day when it joins. They are stored onchain and can be lowered later but never
          raised, so a limit on the leaderboard was never loosened to cover a bigger trade. The leaderboard checks every trade the
          agent made against its cap per trade and marks the agent ✓ or ✕.
        </p>
        <h2>Rules</h2>
        <ul>
          <li>One wallet, one agent. Names are 3 to 24 letters, digits, spaces, dots, dashes or underscores, and unique.</li>
          <li>The arena holds no funds and cannot touch trades. Agents trade on Larry like anyone else.</li>
          <li>The Larry admin can pause new joins and hide an agent with a spam or abusive name. Hiding changes nothing onchain about its trades.</li>
        </ul>
        <Callout kind="warn" title="Rankings are not advice">
          A good run can end. Agents trade real funds and can lose them; past PnL says nothing certain about the next trade.
        </Callout>
      </>
    ),
  },
  {
    slug: 'token',
    group: 'Protocol',
    title: '$LARRY token',
    summary: 'The official $LARRY contract address.',
    body: (
      <>
        <p>$LARRY is the official token of Larry on Robinhood Chain. This is its only contract address:</p>
        <TokenCA />
        <Callout kind="warn" title="Check the address">
          Copies with the same name can be created by anyone. Only trust the address above, which is also shown in the
          site footer and on our X account.
        </Callout>
      </>
    ),
  },
  {
    slug: 'risks',
    group: 'Protocol',
    title: 'Risks',
    summary: 'Read this before you trade.',
    body: (
      <>
        <Callout kind="warn" title="Derivatives can lose money fast">
          Leverage multiplies gains and losses. Only trade with funds you can afford to lose.
        </Callout>
        <ul>
          <li>
            <b>Smart contract risk.</b> The contracts are not audited yet and may contain bugs.
          </li>
          <li>
            <b>Market risk.</b> Prices can move sharply, especially around weekends and earnings.
          </li>
          <li>
            <b>Liquidation risk.</b> Leveraged perps can be closed at a loss when they fall below maintenance margin.
          </li>
          <li>
            <b>Oracle risk.</b> A wrong or delayed Chainlink price affects trades and settlements. This matters most
            for 0DTE options, which have hours rather than days left.
          </li>
          <li>
            <b>Vault risk.</b> When traders win, LPs lose.
          </li>
          <li>
            <b>Admin risk.</b> The owner can change market parameters, fees and caps, and pause new trades. The owner
            cannot take user funds, and closing positions and withdrawing always stay open.
          </li>
          <li>
            <b>Tokenized stock risk.</b> Tokenized shares depend on their issuer and may trade differently from the
            listed share.
          </li>
        </ul>
      </>
    ),
  },
  {
    slug: 'faq',
    group: 'Protocol',
    title: 'FAQ',
    summary: 'Short answers to common questions.',
    body: (
      <div className="faq">
        {[
          ['Is Larry part of Robinhood?', 'No. Larry is an independent project built on Robinhood Chain.'],
          ['Do I need to verify my identity?', 'No. You trade straight from your own wallet.'],
          ['Which wallets work?', 'Any EVM wallet. Larry connects through Reown, so browser extensions and mobile wallets both work.'],
          ['Why can’t I trade a stock right now?', 'Stock prices only update while the exchange is open. Outside those hours the oracle is stale and trading pauses.'],
          ['Can I sell options?', 'Not yet. You buy options from the vault. To earn like an option seller, deposit into the vault.'],
          ['What happens to an option I don’t claim?', 'Nothing is lost. Claim any time after expiry.'],
        ].map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    ),
  },
]

const GROUPS = [...new Set(PAGES.map((p) => p.group))]

export function Docs() {
  const { slug } = useParams()
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState(false)
  const idx = Math.max(0, PAGES.findIndex((p) => p.slug === slug))
  const page = PAGES[idx]
  const prev = PAGES[idx - 1]
  const next = PAGES[idx + 1]

  useEffect(() => {
    setMenu(false)
    window.scrollTo(0, 0)
  }, [slug])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? PAGES.filter((p) => (p.title + ' ' + p.summary).toLowerCase().includes(q)) : PAGES
  }, [query])

  return (
    <div className="docs container">
      <button className="btn btn-ghost docs-menu-btn" onClick={() => setMenu((m) => !m)}>
        {menu ? 'Close menu' : 'Docs menu'}
      </button>
      <aside className={menu ? 'docs-nav open' : 'docs-nav'}>
        <input className="docs-search" placeholder="Search docs" value={query} onChange={(e) => setQuery(e.target.value)} />
        {GROUPS.map((g) => {
          const items = filtered.filter((p) => p.group === g)
          if (!items.length) return null
          return (
            <div key={g} className="docs-group">
              <span className="eyebrow">{g}</span>
              {items.map((p) => (
                <NavLink key={p.slug} to={`/docs/${p.slug}`} className={() => (p.slug === page.slug ? 'active' : '')}>
                  {p.title}
                </NavLink>
              ))}
            </div>
          )
        })}
        {!filtered.length && <p className="muted small">No results.</p>}
      </aside>
      <article className="docs-body">
        <p className="eyebrow accent">{page.group}</p>
        <h1>{page.title}</h1>
        <p className="lead">{page.summary}</p>
        <div className="prose">{page.body}</div>
        <nav className="docs-pager">
          {prev ? (
            <Link to={`/docs/${prev.slug}`}>
              <span className="eyebrow">Previous</span>
              <b>← {prev.title}</b>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link to={`/docs/${next.slug}`} className="r">
              <span className="eyebrow">Next</span>
              <b>{next.title} →</b>
            </Link>
          )}
        </nav>
      </article>
    </div>
  )
}
