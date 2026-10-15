import { getAddress } from 'viem'

/** Official $LARRY token on Robinhood Chain. Shown on the site so people can check the contract address. */
export const LARRY_TOKEN = {
  symbol: 'LARRY',
  address: getAddress('0x72587018a341d5b668c0479e73b2ee1c8d06f4f4'),
} as const
