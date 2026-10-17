import { SmartLink as Link } from '../components/SmartLink'
import { ASSETS } from '../config/markets'
import { AssetIcon } from '../components/AssetIcon'
import { TokenCA } from '../components/TokenCA'
import { BurnTracker } from '../components/BurnTracker'
import { Sparkline } from '../components/Sparkline'
import { useFeedHistory } from '../lib/history'
import { useProtocol } from '../lib/protocol'
import { cls, compactUsd, num, pct } from '../lib/format'

const PRODUCTS = [
  {
    to: '/options',
    tag: 'Options',
    title: 'Options on every market',
    body: 'Calls and puts on crypto and tokenized stocks. Daily 0DTE and Friday expiries, cash settled, priced onchain.',
  },
  {
    to: '/perps',
    tag: 'Perpetuals',
    title: 'Perps with real leverage',
    body: 'Go long or short with isolated margin. Chainlink prices, onchain liquidations, no order book games.',
  },
  {
    to: '/vaults',
    tag: 'Vault',
    title: 'Be the house',
    body: 'Deposit USDG into the Larry vault and earn the fees, premiums and losses of every trader.',
  },
]

const PILLARS = [
  { n: '01', title: 'Self custody', body: 'Funds live in smart contracts. No account, no broker, no withdrawal queue.' },
  { n: '02', title: 'Always solvent', body: 'Every position reserves its maximum payout in the vault before it opens.' },
  { n: '03', title: 'Stocks and crypto', body: 'Trade TSLA, NVDA, META and more next to ETH, BTC and LINK.' },
  { n: '04', title: 'Chainlink prices', body: 'Robinhood Chain’s official oracle prices every trade and every settlement.' },
]

function MarketRow({ idx }: { idx: number }) {
  const p = useProtocol()
  const a = ASSETS[idx]
  const price = p.prices[a.symbol]
  const listed = !!p.perps.markets[idx]?.enabled || !!p.options.markets[idx]?.enabled
  const hist = useFeedHistory(price?.feed, price?.roundId, 8, 24)
  return (
    <Link to={`/perps?asset=${a.symbol}`} className="market-row">
      <div className="asset-cell">
        <AssetIcon symbol={a.symbol} size={36} />
        <div>
          <b>{a.symbol}</b>
          <div className="muted small">{a.name}</div>
        </div>
        {a.kind === 'stock' && <span className="tag">{a.tag ?? 'Stock'}</span>}
      </div>
      <Sparkline values={hist.map((x) => x.p)} />
      <div className="r">
        <div className="mono">{price ? `$${num(price.price)}` : ''}</div>
        <div className="muted small">{!listed ? 'Coming soon' : price?.stale ? 'Market closed' : 'Live'}</div>
      </div>
      <div className="r hide-sm">
        <div className="mono">{pct(p.options.markets[idx] ? Number(p.options.markets[idx]!.vol) / 1e18 : a.vol, 0)}</div>
        <div className="muted small">Implied vol</div>
      </div>
    </Link>
  )
}

/** A 24 hour dial with today's run towards the next 08:00 UTC expiry. */
function DayDial() {
  const nowH = (Date.now() / 3600000) % 24
  const R = 120
  const pt = (h: number, r: number) => {
    const a = (h / 24) * 2 * Math.PI - Math.PI / 2
    return [160 + r * Math.cos(a), 160 + r * Math.sin(a)]
  }
  // From the last 08:00 to now, clockwise.
  const from = 8
  const to = nowH >= 8 ? nowH : nowH + 24
  const [x0, y0] = pt(from, R + 14)
  const [x1, y1] = pt(to, R + 14)
  const large = to - from > 12 ? 1 : 0
  return (
    <svg className="day-dial" viewBox="0 0 320 320" aria-hidden>
      <circle cx="160" cy="160" r={R + 14} fill="none" stroke="var(--border)" strokeWidth="2" />
      {Array.from({ length: 96 }, (_, i) => {
        const big = i % 4 === 0
        const [ax, ay] = pt(i / 4, R)
        const [bx, by] = pt(i / 4, R - (big ? 12 : 6))
        return <line key={i} x1={ax} y1={ay} x2={bx} y2={by} stroke="currentColor" strokeOpacity={big ? 0.5 : 0.18} strokeWidth={big ? 1.6 : 1} />
      })}
      {[0, 6, 12, 18].map((h) => {
        const [x, y] = pt(h, R - 30)
        return (
          <text key={h} x={x} y={y + 4} textAnchor="middle" className="mono" fontSize="12" fill="currentColor" opacity=".45">
            {String(h).padStart(2, '0')}
          </text>
        )
      })}
      <path d={`M${x0},${y0} A${R + 14},${R + 14} 0 ${large} 1 ${x1},${y1}`} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" className="day-arc" />
      <circle cx={x1} cy={y1} r="6" fill="#fff" className="day-head" />
      {(() => {
        const [x, y] = pt(8, R + 30)
        const [lx, ly] = pt(8, R - 30)
        return (
          <>
            <circle cx={x} cy={y} r="5" fill="var(--accent)" />
            <text x={lx} y={ly + 4} textAnchor="middle" className="mono" fontSize="13" fill="var(--accent)">
              08
            </text>
          </>
        )
      })()}
      <text x="160" y="156" textAnchor="middle" className="mono" fontSize="12" fill="currentColor" opacity=".5">
        NEXT EXPIRY
      </text>
      <text x="160" y="180" textAnchor="middle" className="mono" fontSize="20" fill="currentColor">
        08:00 UTC
      </text>
    </svg>
  )
}

export function Home() {
  const p = useProtocol()
  const oi = p.perps.oiLong.reduce((s, v) => s + v, 0n) + p.perps.oiShort.reduce((s, v) => s + v, 0n)
  const listed = ASSETS.filter((_, i) => p.perps.markets[i]?.enabled || p.options.markets[i]?.enabled).length
  const zeroDteIdx = ASSETS.map((_, i) => i).filter((i) => p.options.daily[i] && p.options.markets[i]?.enabled)
  const zeroDteLive = p.live && zeroDteIdx.length > 0
  const zeroDteMarkets = zeroDteIdx.map((i) => ASSETS[i].symbol).join(', ').replace(/, ([^,]*)$/, ' and $1')
  const util = p.pool.totalAssets > 0n ? Number((p.pool.totalReserved * 10_000n) / p.pool.totalAssets) / 1e4 : 0

  // Real numbers only. While the vault is still small, show the facts that are already true
  // (markets, leverage, fees) instead of zeros; TVL and open interest take over once they matter.
  const tvl = p.amount(p.pool.totalAssets)
  const established = p.live && tvl >= 1000
  const perpMarkets = p.perps.markets.filter((m) => m?.enabled)
  const maxLev = perpMarkets.reduce((mx, m) => Math.max(mx, m!.maxLeverage), 0)
  const minFee = perpMarkets.reduce((mn, m) => Math.min(mn, m!.openFeeBps), Infinity)
  const lpShare = 100 - p.perps.protocolShareBps / 100
  const stats: [string, string][] = !p.live
    ? [['Markets', 'Soon'], ['Products', '3'], ['Custody', 'Yours'], ['Network', 'Robinhood']]
    : established
      ? [['Vault TVL', compactUsd(tvl)], ['Open interest', compactUsd(p.amount(oi))], ['Markets live', String(listed)], ['Network', 'Robinhood']]
      : [
          ['Markets live', String(listed)],
          ['Max leverage', maxLev ? `${maxLev}x` : 'Soon'],
          ['Trading fee', Number.isFinite(minFee) ? `${(minFee / 100).toFixed(2)}%` : 'Soon'],
          ['Network', 'Robinhood'],
        ]
  const vaultCards: [string, string][] = established
    ? [['Total value locked', compactUsd(tvl)], ['Utilization', pct(util, 1)], ['Deposit cap', compactUsd(p.amount(p.pool.depositCap))]]
    : [
        ['Fees to LPs', p.live ? `${lpShare}%` : 'Soon'],
        ['Deposit lock', p.live ? `${Math.round(p.pool.lockPeriod / 3600)}h` : 'Soon'],
        ['Deposit cap', p.live ? compactUsd(p.amount(p.pool.depositCap)) : 'Soon'],
      ]

  return (
    <>
      <section className="hero">
        <div className="hero-bg" />
        <div className="container hero-inner">
          <p className="eyebrow">Options · Perps · Vault</p>
          <h1 className="display">
            Take the edge back
            <br />
            <span className="dim">Derivatives for everyone</span>
          </h1>
          <p className="lead">
            Trade options and perpetuals on crypto and tokenized stocks, or be the house in the Larry vault. Onchain, self
            custodial, built on Robinhood Chain.
          </p>
          <div className="hero-cta">
            <Link to="/perps" className="btn btn-accent btn-lg">
              Start trading
            </Link>
            <Link to="/docs" className="btn btn-ghost btn-lg">
              Read the docs
            </Link>
          </div>
        </div>
        <div className="container hero-stats">
          {stats.map(([k, v]) => (
            <div key={k}>
              <span className="eyebrow">{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="section container">
        <div className="section-head">
          <div>
            <p className="eyebrow">01 Markets</p>
            <h2>Every market, one wallet</h2>
          </div>
          <Link to="/perps" className="link">
            Open app →
          </Link>
        </div>
        <div className="market-list">
          {ASSETS.map((a, i) => {
            const on = !!p.perps.markets[i]?.enabled || !!p.options.markets[i]?.enabled
            return listed && !on ? null : <MarketRow key={a.symbol} idx={i} />
          })}
        </div>
      </section>

      <section className="section container">
        <div className="section-head">
          <div>
            <p className="eyebrow">02 Products</p>
            <h2>Three ways to play</h2>
          </div>
        </div>
        <div className="product-grid">
          {PRODUCTS.map((x) => (
            <Link to={x.to} className="product" key={x.to}>
              <span className="eyebrow accent">{x.tag}</span>
              <h3>{x.title}</h3>
              <p className="muted">{x.body}</p>
              <span className="product-go">→</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section container">
        <div className="zdte-band">
          <div className="zdte-copy">
            <p className="eyebrow">
              <span className={cls('tag', zeroDteLive ? 'zdte' : 'off')}>{zeroDteLive ? 'Live' : 'Coming soon'}</span> New on Larry
            </p>
            <h2 className="display small-display">
              0<span className="accent">DTE</span>
            </h2>
            <p className="lead">
              Options that live for one day. Buy a call or a put on {zeroDteMarkets || 'ETH, BTC and LINK'} and it settles at the next 08:00 UTC,
              priced onchain and settled by Chainlink.
            </p>
            <ul className="zdte-points">
              <li>Daily expiries next to the Friday ones</li>
              <li>Black Scholes pricing with an extra spread under one day</li>
              <li>Every payout reserved in the vault before you buy</li>
            </ul>
            <Link to="/options" className="btn btn-accent btn-lg">
              {zeroDteLive ? 'Trade 0DTE' : 'Explore options'}
            </Link>
          </div>
          <DayDial />
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
          {PILLARS.map((x) => (
            <div className="pillar" key={x.n}>
              <span className="mono accent">{x.n}</span>
              <h3>{x.title}</h3>
              <p className="muted">{x.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section container">
        <div className="section-head">
          <div>
            <p className="eyebrow">04 Vault</p>
            <h2>Be the house</h2>
          </div>
          <Link to="/vaults" className="link">
            Open vault →
          </Link>
        </div>
        <div className="vault-grid">
          {vaultCards.map(([k, v]) => (
            <div className="card vault-card" key={k}>
              <span className="eyebrow">{k}</span>
              <div className="vault-apy">{v}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="section container">
        <div className="section-head">
          <div>
            <p className="eyebrow">05 Token</p>
            <h2>$LARRY</h2>
          </div>
        </div>
        <div className="card token-card">
          <div>
            <p className="eyebrow accent">Official contract address</p>
            <p className="muted">The only official $LARRY token on Robinhood Chain. Always check the address before you buy.</p>
          </div>
          <TokenCA />
        </div>
        <BurnTracker compact />
      </section>

      <section className="section container">
        <div className="cta">
          <div className="cta-bg" />
          <h2 className="display small-display">
            Take the edge back
            <br />
            <span className="dim">Derivatives for everyone</span>
          </h2>
          <Link to="/perps" className="btn btn-accent btn-lg">
            Launch app
          </Link>
        </div>
      </section>
    </>
  )
}
