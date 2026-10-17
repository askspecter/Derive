import { getAddress } from 'viem'

/** Official $LARRY token on Robinhood Chain. Shown on the site so people can check the contract address. */
export const LARRY_TOKEN = {
  symbol: 'LARRY',
  address: getAddress('0x72587018a341d5b668c0479e73b2ee1c8d06f4f4'),
} as const

/** Addresses that tokens are sent to when burned. Nobody holds their keys. */
export const BURN_ADDRESSES = [getAddress('0x000000000000000000000000000000000000dEaD'), getAddress('0x0000000000000000000000000000000000000000')] as const

/**
 * Supply at launch, in whole tokens, if $LARRY was ever burned with burn() (which lowers totalSupply)
 * instead of a transfer to the dead address. Leave unset when every burn went to the dead address.
 */
export const LARRY_INITIAL_SUPPLY = Number(import.meta.env.VITE_LARRY_INITIAL_SUPPLY ?? 0) || 0

/** LarryBuyback contract that buys and burns $LARRY (deployed from the admin page), shown on the burn page. */
const bb = (import.meta.env.VITE_LARRY_BUYBACK as string | undefined) ?? ''
export const BUYBACK_CONTRACT = /^0x[0-9a-fA-F]{40}$/.test(bb) ? getAddress(bb) : null

/** Pons V2 pool where $LARRY trades: buy(ethIn, minOut, to) with native ETH. Checked onchain: token() is $LARRY. */
// Not VITE_LARRY_POOL: that one is the Larry Vault (LarryPool) address.
const pp = (import.meta.env.VITE_LARRY_DEX_POOL as string | undefined) ?? ''
export const LARRY_POOL = getAddress(/^0x[0-9a-fA-F]{40}$/.test(pp) ? pp : '0x4d17d7ea9f4975738d088e7ec6c15062a6215f16')
