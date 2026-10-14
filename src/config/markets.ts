export type AssetKind = 'crypto' | 'stock'

export interface Asset {
  /** Market id used onchain. Fixed forever: never reuse an id that has been listed. */
  id: number
  symbol: string
  name: string
  kind: AssetKind
  spot: number
  vol: number // annualised implied vol used as ATM baseline
  color: string
  logo: string
  /** Label shown instead of the kind, e.g. ETF. */
  tag?: string
}

// Logos live in public/tokens. ETH uses the Robinhood Chain feather mark.
// Robinhood Chain is home to tokenized equities, so Larry lists stock
// derivatives next to crypto majors.
export const ASSETS: Asset[] = [
  { id: 0, symbol: 'ETH', name: 'Ethereum', kind: 'crypto', spot: 3420, vol: 0.62, color: '#8c9eff', logo: 'tokens/eth.png' },
  { id: 1, symbol: 'BTC', name: 'Bitcoin', kind: 'crypto', spot: 104250, vol: 0.48, color: '#f7931a', logo: 'tokens/btc.svg' },
  { id: 2, symbol: 'SOL', name: 'Solana', kind: 'crypto', spot: 182, vol: 0.78, color: '#14f195', logo: 'tokens/sol.svg' },
  { id: 3, symbol: 'LINK', name: 'Chainlink', kind: 'crypto', spot: 12.45, vol: 0.75, color: '#2a5ada', logo: 'tokens/link.svg' },
  { id: 4, symbol: 'TSLA', name: 'Tesla', kind: 'stock', spot: 412.3, vol: 0.55, color: '#e82127', logo: 'tokens/tsla.svg' },
  { id: 5, symbol: 'NVDA', name: 'NVIDIA', kind: 'stock', spot: 186.7, vol: 0.46, color: '#76b900', logo: 'tokens/nvda.svg' },
  { id: 6, symbol: 'AAPL', name: 'Apple', kind: 'stock', spot: 247.1, vol: 0.27, color: '#a2aaad', logo: 'tokens/aapl.svg' },
  { id: 7, symbol: 'META', name: 'Meta', kind: 'stock', spot: 720, vol: 0.4, color: '#0866FF', logo: 'tokens/meta.svg' },
  { id: 8, symbol: 'MSFT', name: 'Microsoft', kind: 'stock', spot: 510, vol: 0.28, color: '#00A4EF', logo: 'tokens/msft.svg' },
  { id: 9, symbol: 'AMZN', name: 'Amazon', kind: 'stock', spot: 225, vol: 0.35, color: '#FF9900', logo: 'tokens/amzn.svg' },
  { id: 10, symbol: 'GOOGL', name: 'Alphabet', kind: 'stock', spot: 245, vol: 0.32, color: '#FFFFFF', logo: 'tokens/googl.svg' },
  { id: 11, symbol: 'COIN', name: 'Coinbase', kind: 'stock', spot: 340, vol: 0.7, color: '#0052FF', logo: 'tokens/coin.svg' },
  { id: 12, symbol: 'PLTR', name: 'Palantir', kind: 'stock', spot: 175, vol: 0.65, color: '#101113', logo: 'tokens/pltr.svg' },
  { id: 13, symbol: 'MSTR', name: 'Strategy', kind: 'stock', spot: 390, vol: 0.85, color: '#D9232E', logo: 'tokens/mstr.svg' },
  { id: 14, symbol: 'SPY', name: 'SPDR S&P 500 ETF', kind: 'stock', spot: 665, vol: 0.16, color: '#1B3D6D', logo: 'tokens/spy.svg', tag: 'ETF' },
  { id: 15, symbol: 'QQQ', name: 'Invesco QQQ ETF', kind: 'stock', spot: 600, vol: 0.2, color: '#2E2A80', logo: 'tokens/qqq.svg', tag: 'ETF' },
  { id: 16, symbol: 'TSM', name: 'TSMC', kind: 'stock', spot: 290, vol: 0.38, color: '#C8102E', logo: 'tokens/tsm.svg' },
  { id: 17, symbol: 'INTC', name: 'Intel', kind: 'stock', spot: 24, vol: 0.45, color: '#0071C5', logo: 'tokens/intc.svg' },
  { id: 18, symbol: 'MU', name: 'Micron', kind: 'stock', spot: 160, vol: 0.5, color: '#0069B4', logo: 'tokens/mu.svg' },
  { id: 19, symbol: 'ORCL', name: 'Oracle', kind: 'stock', spot: 290, vol: 0.4, color: '#F80000', logo: 'tokens/orcl.svg' },
  // ids 20 to 25 (ASML, BABA, CRCL, IONQ, RKLB, DELL) are retired. Never reuse an id.
]

export const assetBySymbol = (s: string) => ASSETS.find((a) => a.symbol === s) ?? ASSETS[0]

/** Position of an asset in ASSETS, used to index the per asset arrays in protocol state. */
export const assetIndex = (symbol: string) => Math.max(0, ASSETS.findIndex((a) => a.symbol === symbol))

/** Position in ASSETS of an onchain market id, or -1 when the id isn't shown. */
export const indexOfMarketId = (id: number) => ASSETS.findIndex((a) => a.id === id)

export interface Vault {
  id: string
  name: string
  strategy: string
  asset: string
  deposit: string
  apy: number
  tvl: number
  risk: 'Low' | 'Medium' | 'High'
  description: string
}

export const VAULTS: Vault[] = [
  {
    id: 'eth-cc',
    name: 'ETH Covered Call',
    strategy: 'Covered Call',
    asset: 'ETH',
    deposit: 'wETH',
    apy: 0.142,
    tvl: 18_420_000,
    risk: 'Medium',
    description: 'Sells weekly OTM calls against wETH collateral. Earns premium, caps upside above strike.',
  },
  {
    id: 'btc-pp',
    name: 'BTC Principal Protected',
    strategy: 'Principal Protected',
    asset: 'BTC',
    deposit: 'USDC',
    apy: 0.068,
    tvl: 9_870_000,
    risk: 'Low',
    description: 'Lends USDC for base yield and spends the interest on BTC call spreads for upside exposure.',
  },
  {
    id: 'tsla-cc',
    name: 'TSLA Covered Call',
    strategy: 'Covered Call',
    asset: 'TSLA',
    deposit: 'TSLA',
    apy: 0.189,
    tvl: 6_045_000,
    risk: 'Medium',
    description: 'Covered calls on tokenized Tesla shares, rolled every Friday at market close.',
  },
  {
    id: 'eth-basis',
    name: 'ETH Basis Trade',
    strategy: 'Delta Neutral',
    asset: 'ETH',
    deposit: 'USDC',
    apy: 0.117,
    tvl: 12_780_000,
    risk: 'Low',
    description: 'Long spot, short perp. Collects funding while staying market neutral.',
  },
  {
    id: 'nvda-ic',
    name: 'NVDA Iron Condor',
    strategy: 'Short Volatility',
    asset: 'NVDA',
    deposit: 'USDC',
    apy: 0.274,
    tvl: 2_190_000,
    risk: 'High',
    description: 'Sells both wings in quiet weeks without earnings. Profits when NVDA stays in range.',
  },
]
