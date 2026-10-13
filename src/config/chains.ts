export interface ChainConfig {
  id: number
  hexId: string
  name: string
  rpcUrl: string
  explorerUrl: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
}

// Robinhood Chain mainnet: an Arbitrum Orbit L2 settling to Ethereum, ETH is the gas token.
export const ROBINHOOD_CHAIN: ChainConfig = {
  id: 4663,
  hexId: '0x1237',
  name: 'Robinhood Chain',
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  explorerUrl: 'https://robinhoodchain.blockscout.com',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
}

export const isRobinhoodChain = (id: number | null | undefined) => id === ROBINHOOD_CHAIN.id
