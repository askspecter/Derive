import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { ASSETS, VAULTS } from '../config/markets'
import { AssetIcon } from '../components/AssetIcon'
import { pct } from '../lib/format'

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

const PAGES: Page[] = [
  {
    slug: 'introduction',
    group: 'Getting started',
    title: 'Introduction',
    summary: 'What Larry is and what you can do with it.',
    body: (
      <>
        <p>
          Larry is an onchain derivatives exchange on Robinhood Chain. You can trade options and perpetual futures on
          crypto and tokenized stocks, or deposit into vaults that run options strategies for you.
        </p>
        <p>Everything runs from a single margin account that you control with your own wallet.</p>
        <div className="doc-cards">
          <Link to="/docs/options" className="doc-card">
            <span className="eyebrow accent">Trade</span>
            <b>Options</b>
            <span className="muted">Calls and puts with weekly and monthly expiries.</span>
          </Link>
          <Link to="/docs/perpetuals" className="doc-card">
            <span className="eyebrow accent">Trade</span>
            <b>Perpetuals</b>
            <span className="muted">Long or short with up to 20x leverage.</span>
          </Link>
          <Link to="/docs/vaults" className="doc-card">
            <span className="eyebrow accent">Earn</span>
            <b>Vaults</b>
            <span className="muted">Automated strategies that roll every week.</span>
          </Link>
          <Link to="/docs/quickstart" className="doc-card">
            <span className="eyebrow accent">Start</span>
            <b>Quickstart</b>
            <span className="muted">From wallet to first trade in five minutes.</span>
          </Link>
        </div>
        <h2>Why Larry</h2>
        <ul>
          <li>
            <b>Self custody.</b> Your collateral sits in smart contracts, never with a broker.
          </li>
          <li>
            <b>Stocks and crypto together.</b> HOOD, TSLA, NVDA and AAPL trade next to ETH, BTC and SOL, around the
            clock.
          </li>
          <li>
            <b>Portfolio margin.</b> Positions that hedge each other reduce the margin you post.
          </li>
          <li>
            <b>Low cost.</b> Robinhood Chain gas costs cents, so small traders are not priced out.
          </li>
        </ul>
        <Callout title="Preview release">
          Larry is in preview. Prices come from a simulated feed and every trade is a paper position stored in your
          browser. No real funds are used until the protocol contracts launch.
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
      <>
        <Steps
          items={[
            <>
              <b>Install a wallet.</b> Robinhood Wallet, MetaMask, Rabby or any EVM wallet works.
            </>,
            <>
              <b>Connect.</b> Press <span className="kbd">Connect wallet</span> in the top right. Larry asks your
              wallet to switch to Robinhood Chain and adds the network if it is missing.
            </>,
            <>
              <b>Fund your account.</b> Bridge ETH or USDC to Robinhood Chain. In preview every account starts with
              $25,000 of paper margin.
            </>,
            <>
              <b>Pick a market.</b> Open <Link to="/options">Options</Link> or <Link to="/perps">Perps</Link> and
              choose an asset from the bar at the top.
            </>,
            <>
              <b>Place the trade.</b> Review price, margin and breakeven in the order ticket, then confirm. Your
              position appears in <Link to="/portfolio">Portfolio</Link>.
            </>,
          ]}
        />
      </>
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
          Ethereum. Larry runs on mainnet only.
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
        <p>To add the network by hand, use these values:</p>
        <pre className="code">{`{
  "chainId": "${ROBINHOOD_CHAIN.hexId}",
  "chainName": "${ROBINHOOD_CHAIN.name}",
  "nativeCurrency": { "name": "Ether", "symbol": "ETH", "decimals": 18 },
  "rpcUrls": ["${ROBINHOOD_CHAIN.rpcUrl}"],
  "blockExplorerUrls": ["${ROBINHOOD_CHAIN.explorerUrl}"]
}`}</pre>
      </>
    ),
  },
  {
    slug: 'markets',
    group: 'Trading',
    title: 'Markets',
    summary: 'Every asset you can trade on Larry.',
    body: (
      <>
        <p>Each asset has an options market and a perpetual market. Stocks are tokenized shares on Robinhood Chain.</p>
        <table className="doc-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Type</th>
              <th className="r">Base IV</th>
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
                <td>{a.kind === 'stock' ? 'Tokenized stock' : 'Crypto'}</td>
                <td className="r mono">{pct(a.vol, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    ),
  },
  {
    slug: 'options',
    group: 'Trading',
    title: 'Options',
    summary: 'How Larry options work, from expiry to settlement.',
    body: (
      <>
        <p>
          Larry lists European options that settle in cash. A call pays out when the price ends above the strike, a
          put pays out when it ends below.
        </p>
        <h2>Expiries</h2>
        <p>
          The next four Fridays are always listed, plus the last Friday of the coming months. Options expire at 08:00
          UTC.
        </p>
        <h2>Reading the chain</h2>
        <ul>
          <li>Calls are on the left, puts on the right, strikes in the middle.</li>
          <li>Click an ask to buy, click a bid to sell.</li>
          <li>Shaded cells are in the money.</li>
          <li>
            <b>IV</b> is implied volatility and <b>Δ</b> is delta, how much the option moves for a $1 move in the
            asset. Put deltas are shown as their size.
          </li>
        </ul>
        <h2>Buying and selling</h2>
        <p>
          Buyers pay the premium up front and can never lose more than that. Sellers receive the premium and post 20%
          of the strike value as margin.
        </p>
        <h2>Settlement</h2>
        <p>At expiry each option is worth its intrinsic value and the cash moves to your margin account.</p>
        <ul>
          <li>
            <b>Call:</b> pays how far the final price is above the strike, times size. Zero if it ends below.
          </li>
          <li>
            <b>Put:</b> pays how far the final price is below the strike, times size. Zero if it ends above.
          </li>
        </ul>
      </>
    ),
  },
  {
    slug: 'perpetuals',
    group: 'Trading',
    title: 'Perpetuals',
    summary: 'Leverage, funding and liquidation price.',
    body: (
      <>
        <p>
          Perpetual futures track the asset price with no expiry. Choose long or short, a size in dollars and a
          leverage from 1x to 20x.
        </p>
        <h2>Margin</h2>
        <p>Initial margin is your position size divided by leverage. A $1,000 position at 5x needs $200.</p>
        <h2>Funding</h2>
        <p>
          Every hour longs and shorts pay each other a funding rate that keeps the perp close to the oracle price. A ▲
          rate means longs pay shorts, a ▼ rate means shorts pay longs.
        </p>
        <h2>Liquidation</h2>
        <p>
          If losses push your remaining margin below 5% of the position, it is closed at the oracle price. The order
          ticket shows the estimated liquidation price before you trade.
        </p>
      </>
    ),
  },
  {
    slug: 'margin',
    group: 'Trading',
    title: 'Portfolio margin',
    summary: 'One account, all positions, margin on real risk.',
    body: (
      <>
        <p>
          Options, perps and vault deposits all share one margin account. Free margin is what you can use for new
          trades. Equity is free margin plus the value of every open position.
        </p>
        <p>
          When positions offset each other, such as a short call against a long perp, the account is charged for the
          combined risk rather than each leg on its own.
        </p>
        <Callout title="Tip">Check Portfolio before adding size. It shows equity, free margin and unrealized PnL live.</Callout>
      </>
    ),
  },
  {
    slug: 'vaults',
    group: 'Earn',
    title: 'Vaults',
    summary: 'Automated strategies and how deposits earn.',
    body: (
      <>
        <p>
          A vault pools deposits and runs one strategy every week. You receive shares, and their value grows as the
          vault earns premium or funding.
        </p>
        <table className="doc-table">
          <thead>
            <tr>
              <th>Vault</th>
              <th>Strategy</th>
              <th>Risk</th>
              <th className="r">Est. APY</th>
            </tr>
          </thead>
          <tbody>
            {VAULTS.map((v) => (
              <tr key={v.id}>
                <td>{v.name}</td>
                <td>{v.strategy}</td>
                <td>{v.risk}</td>
                <td className="r mono">{pct(v.apy, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Strategies</h2>
        <ul>
          <li>
            <b>Covered call.</b> Holds the asset and sells calls above the price. Earns premium but gives up gains
            above the strike.
          </li>
          <li>
            <b>Secured put.</b> Holds USDC and sells puts below the price. Earns premium and may end up buying the
            asset at the strike.
          </li>
          <li>
            <b>Principal protected.</b> Earns lending yield and spends it on call spreads, so the deposit is not put
            at risk.
          </li>
          <li>
            <b>Basis trade.</b> Long spot and short perp at the same size. Collects funding with no price exposure.
          </li>
          <li>
            <b>Iron condor.</b> Sells both a call spread and a put spread. Earns most when the price stays in range.
          </li>
        </ul>
        <Callout kind="warn" title="APY is an estimate">
          Returns change every week with volatility and funding. A strategy can lose money when the market moves
          sharply.
        </Callout>
      </>
    ),
  },
  {
    slug: 'pricing',
    group: 'Protocol',
    title: 'Pricing and oracles',
    summary: 'Where prices come from and how options are valued.',
    body: (
      <>
        <p>
          Every market uses an index price from an oracle. Perps mark to that price, and options are valued with the
          Black Scholes model using a volatility smile per expiry.
        </p>
        <ul>
          <li>Strikes far from the price carry higher implied volatility than strikes near it.</li>
          <li>Puts below the price carry extra volatility, as in real markets.</li>
          <li>Quotes show a bid and an ask around the model price.</li>
        </ul>
        <Callout title="Preview">The preview uses a simulated price feed that moves every 1.5 seconds.</Callout>
      </>
    ),
  },
  {
    slug: 'fees',
    group: 'Protocol',
    title: 'Fees',
    summary: 'What it costs to trade on Larry.',
    body: (
      <table className="doc-table">
        <thead>
          <tr>
            <th>Action</th>
            <th className="r">Fee</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Perpetual trade</td>
            <td className="r mono">0.03% of size</td>
          </tr>
          <tr>
            <td>Option trade</td>
            <td className="r mono">Included in spread</td>
          </tr>
          <tr>
            <td>Vault deposit or withdrawal</td>
            <td className="r mono">Free</td>
          </tr>
          <tr>
            <td>Network gas</td>
            <td className="r mono">About $0.01</td>
          </tr>
        </tbody>
      </table>
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
            <b>Market risk.</b> Prices can move sharply, especially on weekends and around earnings.
          </li>
          <li>
            <b>Liquidation risk.</b> Leveraged perps and sold options can be closed automatically at a loss.
          </li>
          <li>
            <b>Smart contract risk.</b> Code can contain bugs even after audits.
          </li>
          <li>
            <b>Oracle risk.</b> A wrong or delayed price can trigger trades at bad levels.
          </li>
          <li>
            <b>Tokenized stock risk.</b> Tokenized shares depend on the issuer and may differ from the listed share.
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
          ['Which wallets work?', 'Any EVM wallet, including Robinhood Wallet, MetaMask and Rabby.'],
          ['Can I trade stocks outside market hours?', 'Yes. Tokenized stock markets on Larry are open 24/7.'],
          ['Is my money at risk in the preview?', 'No. The preview uses paper balances only.'],
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
