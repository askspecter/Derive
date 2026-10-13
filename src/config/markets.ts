export type AssetKind = 'crypto' | 'stock'

export interface Asset {
  symbol: string
  name: string
  kind: AssetKind
  spot: number
  vol: number // annualised implied vol used as ATM baseline
  color: string
  logo: string
}

// Logos live in public/tokens. ETH uses the Robinhood Chain feather mark.
// Robinhood Chain is home to tokenized equities, so Sherwood lists stock
// derivatives next to crypto majors.
export const ASSETS: Asset[] = [
  { symbol: 'ETH', name: 'Ethereum', kind: 'crypto', spot: 3420, vol: 0.62, color: '#8c9eff', logo: 'tokens/eth.png' },
  { symbol: 'BTC', name: 'Bitcoin', kind: 'crypto', spot: 104250, vol: 0.48, color: '#f7931a', logo: 'tokens/btc.svg' },
  { symbol: 'SOL', name: 'Solana', kind: 'crypto', spot: 182, vol: 0.78, color: '#14f195', logo: 'tokens/sol.svg' },
  { symbol: 'HOOD', name: 'Robinhood Markets', kind: 'stock', spot: 118.4, vol: 0.58, color: '#ccff00', logo: 'tokens/hood.svg' },
  { symbol: 'TSLA', name: 'Tesla', kind: 'stock', spot: 412.3, vol: 0.55, color: '#e82127', logo: 'tokens/tsla.svg' },
  { symbol: 'NVDA', name: 'NVIDIA', kind: 'stock', spot: 186.7, vol: 0.46, color: '#76b900', logo: 'tokens/nvda.svg' },
  { symbol: 'AAPL', name: 'Apple', kind: 'stock', spot: 247.1, vol: 0.27, color: '#a2aaad', logo: 'tokens/aapl.svg' },
]

export const assetBySymbol = (s: string) => ASSETS.find((a) => a.symbol === s) ?? ASSETS[0]

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
    id: 'hood-csp',
    name: 'HOOD Cash-Secured Put',
    strategy: 'Cash-Secured Put',
    asset: 'HOOD',
    deposit: 'USDC',
    apy: 0.215,
    tvl: 4_310_000,
    risk: 'Medium',
    description: 'Sells weekly puts on tokenized HOOD. Get paid to buy the dip at a discount.',
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
    description: 'Sells wings around earnings-free weeks. Profits when NVDA stays in range.',
  },
]
