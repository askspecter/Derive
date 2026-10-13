import { Link } from 'react-router-dom'
import { ASSETS, VAULTS } from '../config/markets'
import { DEFAULT_CHAIN } from '../config/chains'
import { useMarket } from '../lib/market'
import { useWallet } from '../lib/wallet'
import { Ticker } from '../components/Ticker'
import { cls, compactUsd, num, pct, signedPct } from '../lib/format'

const FEATURES = [
  {
    title: 'Options on everything',
    body: 'European, cash-settled options on ETH, BTC, SOL and tokenized stocks like HOOD, TSLA and NVDA. Weekly and monthly expiries.',
    icon: '◇',
  },
  {
    title: 'Perpetuals up to 20x',
    body: 'Trade perps against the same portfolio margin account. Funding paid hourly, marks from a decentralized oracle.',
    icon: '∞',
  },
  {
    title: 'Portfolio margin',
    body: 'One subaccount, cross-collateralized. Hedged option and perp books net out, so you post margin on risk — not on notional.',
    icon: '⊞',
  },
  {
    title: 'Structured vaults',
    body: 'Covered calls, cash-secured puts and basis trades, executed automatically every week. Deposit once, earn premium.',
    icon: '◎',
  },
  {
    title: 'Self-custodial',
    body: 'Your collateral sits in smart contracts on Robinhood Chain. Withdraw any time, verify everything on the explorer.',
    icon: '⛨',
  },
  {
    title: 'Ethereum security',
    body: 'Robinhood Chain is an Arbitrum Orbit L2 that posts data to Ethereum. Sub-second blocks and cents-level gas.',
    icon: '⟠',
  },
]

export function Home() {
  const { prices, open24h } = useMarket()
  const wallet = useWallet()
  const tvl = VAULTS.reduce((s, v) => s + v.tvl, 0) + 61_800_000

  return (
    <>
      <section className="hero">
        <div className="hero-glow" />
        <div className="container hero-inner">
          <div className="pill">
            <span className="dot" /> Live on {DEFAULT_CHAIN.name}
          </div>
          <h1>
            The onchain derivatives
            <br />
            exchange for <span className="accent">everyone</span>.
          </h1>
          <p className="lead">
            Trade options and perpetuals on crypto and tokenized stocks, or earn yield from automated strategies — all
            self-custodial, all on Robinhood Chain.
          </p>
          <div className="hero-cta">
            <Link to="/options" className="btn btn-accent btn-lg">
              Start trading
            </Link>
            {!wallet.address ? (
              <button className="btn btn-ghost btn-lg" onClick={wallet.connect}>
                Connect wallet
              </button>
            ) : (
              <Link to="/vaults" className="btn btn-ghost btn-lg">
                Explore vaults
              </Link>
            )}
          </div>
          <div className="hero-stats">
            <div>
              <div className="stat-value">{compactUsd(tvl)}</div>
              <div className="muted small">Total value locked</div>
            </div>
            <div>
              <div className="stat-value">{compactUsd(4_820_000_000)}</div>
              <div className="muted small">Cumulative volume</div>
            </div>
            <div>
              <div className="stat-value">{ASSETS.length}</div>
              <div className="muted small">Markets</div>
            </div>
            <div>
              <div className="stat-value">~$0.01</div>
              <div className="muted small">Avg. gas per trade</div>
            </div>
          </div>
        </div>
      </section>

      <Ticker />

      <section className="section container">
        <div className="section-head">
          <h2>Markets</h2>
          <Link to="/options" className="link">
            View all →
          </Link>
        </div>
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="r">Price</th>
                <th className="r">24h</th>
                <th className="r hide-sm">ATM IV</th>
                <th className="r"></th>
              </tr>
            </thead>
            <tbody>
              {ASSETS.map((a) => {
                const ch = prices[a.symbol] / open24h[a.symbol] - 1
                return (
                  <tr key={a.symbol}>
                    <td>
                      <div className="asset-cell">
                        <span className="asset-icon" style={{ background: a.color }}>
                          {a.symbol[0]}
                        </span>
                        <div>
                          <b>{a.symbol}</b>
                          <div className="muted small">{a.name}</div>
                        </div>
                        {a.kind === 'stock' && <span className="tag">Stock</span>}
                      </div>
                    </td>
                    <td className="r mono">${num(prices[a.symbol])}</td>
                    <td className={cls('r mono', ch >= 0 ? 'up' : 'down')}>{signedPct(ch)}</td>
                    <td className="r mono hide-sm">{pct(a.vol, 1)}</td>
                    <td className="r">
                      <Link to={`/options?asset=${a.symbol}`} className="btn btn-sm btn-ghost">
                        Trade
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section container">
        <div className="section-head">
          <h2>Built for serious traders. Simple enough for everyone.</h2>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div className="card feature" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section container">
        <div className="section-head">
          <h2>Top vaults</h2>
          <Link to="/vaults" className="link">
            All vaults →
          </Link>
        </div>
        <div className="vault-grid">
          {[...VAULTS]
            .sort((a, b) => b.apy - a.apy)
            .slice(0, 3)
            .map((v) => (
              <Link to="/vaults" className="card vault-card" key={v.id}>
                <div className="muted small">{v.strategy}</div>
                <h3>{v.name}</h3>
                <div className="vault-apy">{pct(v.apy, 1)}</div>
                <div className="muted small">Est. APY · TVL {compactUsd(v.tvl)}</div>
              </Link>
            ))}
        </div>
      </section>

      <section className="section container">
        <div className="card cta-card">
          <div>
            <h2>Trade where the stocks live.</h2>
            <p className="muted">
              Robinhood Chain brings tokenized equities onchain. Sherwood brings the derivatives layer: hedge, lever up,
              or earn yield on them 24/7.
            </p>
          </div>
          <Link to="/options" className="btn btn-accent btn-lg">
            Launch app
          </Link>
        </div>
      </section>
    </>
  )
}
