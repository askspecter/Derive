export interface ChainConfig {
  id: number
  hexId: string
  name: string
  shortName: string
  rpcUrl: string
  explorerUrl: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  testnet: boolean
}

// Robinhood Chain is an Arbitrum Orbit L2 settling to Ethereum, ETH is the gas token.
export const ROBINHOOD_MAINNET: ChainConfig = {
  id: 4663,
  hexId: '0x1237',
  name: 'Robinhood Chain',
  shortName: 'Mainnet',
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  explorerUrl: 'https://robinhoodchain.blockscout.com',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  testnet: false,
}

export const ROBINHOOD_TESTNET: ChainConfig = {
  id: 46630,
  hexId: '0xb626',
  name: 'Robinhood Chain Testnet',
  shortName: 'Testnet',
  rpcUrl: 'https://rpc.testnet.chain.robinhood.com',
  explorerUrl: 'https://explorer.testnet.chain.robinhood.com',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  testnet: true,
}

export const SUPPORTED_CHAINS = [ROBINHOOD_MAINNET, ROBINHOOD_TESTNET]

export const DEFAULT_CHAIN =
  import.meta.env.VITE_DEFAULT_NETWORK === 'mainnet' ? ROBINHOOD_MAINNET : ROBINHOOD_TESTNET

export const chainById = (id: number | null | undefined) =>
  SUPPORTED_CHAINS.find((c) => c.id === id)
