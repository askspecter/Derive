import { Link } from 'react-router-dom'
import { ASSETS, VAULTS } from '../config/markets'
import { AssetIcon } from '../components/AssetIcon'
import { Sparkline } from '../components/Sparkline'
import { useMarket } from '../lib/market'
import { changePct, cls, compactUsd, num, pct } from '../lib/format'

const PRODUCTS = [
  {
    to: '/options',
    tag: 'Options',
    title: 'Options on every market',
    body: 'Calls and puts on crypto and tokenized stocks. Weekly and monthly expiries, cash settled, priced live.',
  },
  {
    to: '/perps',
    tag: 'Perpetuals',
    title: 'Perps up to 20x',
    body: 'Go long or short with one margin account. Funding settles every hour against the oracle price.',
  },
  {
    to: '/vaults',
    tag: 'Vaults',
    title: 'Yield on autopilot',
    body: 'Covered calls, secured puts and basis trades that roll every week. Deposit once and collect premium.',
  },
]

const PILLARS = [
  { n: '01', title: 'Self custody', body: 'Collateral lives in smart contracts you control. Withdraw any time.' },
  { n: '02', title: 'Portfolio margin', body: 'Hedged books net out, so margin follows real risk instead of notional.' },
  { n: '03', title: 'Stocks and crypto', body: 'Trade HOOD, TSLA, NVDA and AAPL next to ETH, BTC and SOL, around the clock.' },
  { n: '04', title: 'Ethereum security', body: 'Robinhood Chain settles to Ethereum with fast blocks and gas that costs cents.' },
]

export function Home() {
  const { prices, open24h, candles } = useMarket()
  const tvl = VAULTS.reduce((s, v) => s + v.tvl, 0) + 61_800_000

  return (
    <>
      <section className="hero">
        <div className="hero-bg" />
        <div className="container hero-inner">
          <p className="eyebrow">Options · Perps · Vaults</p>
          <h1 className="display">
            Take the edge back
            <br />
            <span className="dim">Derivatives for everyone</span>
          </h1>
          <p className="lead">
            Trade options and perpetuals on crypto and tokenized stocks, or let a vault do it for you. Onchain, self
            custodial, built on Robinhood Chain.
          </p>
          <div className="hero-cta">
            <Link to="/options" className="btn btn-accent btn-lg">
              Start trading
            </Link>
            <Link to="/docs" className="btn btn-ghost btn-lg">
              Read the docs
            </Link>
          </div>
        </div>
        <div className="container hero-stats">
          <div>
            <span className="eyebrow">Total value locked</span>
            <b>{compactUsd(tvl)}</b>
          </div>
          <div>
            <span className="eyebrow">Volume</span>
            <b>{compactUsd(4_820_000_000)}</b>
          </div>
          <div>
            <span className="eyebrow">Markets</span>
            <b>{ASSETS.length * 2}</b>
          </div>
          <div>
            <span className="eyebrow">Gas per trade</span>
            <b>$0.01</b>
          </div>
        </div>
      </section>

      <section className="section container">
        <div className="section-head">
          <div>
            <p className="eyebrow">01 Markets</p>
            <h2>Every market, one account</h2>
          </div>
          <Link to="/options" className="link">
            Open app →
          </Link>
        </div>
        <div className="market-list">
          {ASSETS.map((a) => {
            const ch = prices[a.symbol] / open24h[a.symbol] - 1
            return (
              <Link to={`/options?asset=${a.symbol}`} className="market-row" key={a.symbol}>
                <div className="asset-cell">
                  <AssetIcon symbol={a.symbol} size={36} />
                  <div>
                    <b>{a.symbol}</b>
                    <div className="muted small">{a.name}</div>
                  </div>
                  {a.kind === 'stock' && <span className="tag">Stock</span>}
                </div>
                <Sparkline candles={candles[a.symbol]} />
                <div className="r">
                  <div className="mono">${num(prices[a.symbol])}</div>
                  <div className={cls('mono small', ch >= 0 ? 'up' : 'down')}>{changePct(ch)}</div>
                </div>
                <div className="r hide-sm">
                  <div className="mono">{pct(a.vol, 1)}</div>
                  <div className="muted small">ATM IV</div>
                </div>
              </Link>
            )
          })}
        </div>
      </section>

      <section className="section container">
        <div className="section-head">
          <div>
            <p className="eyebrow">02 Products</p>
            <h2>Three ways to trade</h2>
          </div>
        </div>
        <div className="product-grid">
          {PRODUCTS.map((p) => (
            <Link to={p.to} className="product" key={p.to}>
              <span className="eyebrow accent">{p.tag}</span>
              <h3>{p.title}</h3>
              <p className="muted">{p.body}</p>
              <span className="product-go">→</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section container">
        <div className="section-head">
          <div>
            <p className="eyebrow">03 Why Larry</p>
            <h2>Built like a pro desk. Open to everyone.</h2>
          </div>
        </div>
        <div className="pillars">
          {PILLARS.map((p) => (
            <div className="pillar" key={p.n}>
              <span className="mono accent">{p.n}</span>
              <h3>{p.title}</h3>
              <p className="muted">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section container">
        <div className="section-head">
          <div>
            <p className="eyebrow">04 Vaults</p>
            <h2>Top yields this week</h2>
          </div>
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
                <div className="vault-top">
                  <AssetIcon symbol={v.asset} size={32} />
                  <span className="eyebrow">{v.strategy}</span>
                </div>
                <h3>{v.name}</h3>
                <div className="vault-apy">{pct(v.apy, 1)}</div>
                <div className="muted small">Est. APY · TVL {compactUsd(v.tvl)}</div>
              </Link>
            ))}
        </div>
      </section>

      <section className="section container">
        <div className="cta">
          <div className="cta-bg" />
          <h2 className="display small-display">
            Take the edge back
            <br />
            <span className="dim">Derivatives for everyone</span>
          </h2>
          <Link to="/options" className="btn btn-accent btn-lg">
            Launch app
          </Link>
        </div>
      </section>
    </>
  )
}
