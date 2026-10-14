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
}

// Logos live in public/tokens. ETH uses the Robinhood Chain feather mark.
// Robinhood Chain is home to tokenized equities, so Larry lists stock
// derivatives next to crypto majors.
export const ASSETS: Asset[] = [
  { id: 0, symbol: 'ETH', name: 'Ethereum', kind: 'crypto', spot: 3420, vol: 0.62, color: '#8c9eff', logo: 'tokens/eth.png' },
  { id: 1, symbol: 'BTC', name: 'Bitcoin', kind: 'crypto', spot: 104250, vol: 0.48, color: '#f7931a', logo: 'tokens/btc.svg' },
  // id 2 was SOL, retired before listing: no Chainlink feed on Robinhood Chain.
  { id: 3, symbol: 'LINK', name: 'Chainlink', kind: 'crypto', spot: 12.45, vol: 0.75, color: '#2a5ada', logo: 'tokens/link.svg' },
  { id: 4, symbol: 'TSLA', name: 'Tesla', kind: 'stock', spot: 412.3, vol: 0.55, color: '#e82127', logo: 'tokens/tsla.svg' },
  { id: 5, symbol: 'NVDA', name: 'NVIDIA', kind: 'stock', spot: 186.7, vol: 0.46, color: '#76b900', logo: 'tokens/nvda.svg' },
  { id: 6, symbol: 'AAPL', name: 'Apple', kind: 'stock', spot: 247.1, vol: 0.27, color: '#a2aaad', logo: 'tokens/aapl.svg' },
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
