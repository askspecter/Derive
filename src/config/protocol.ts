import { getAddress, getContractAddress, isAddress, type Address } from 'viem'
import { ASSETS } from './markets'

const env = import.meta.env

/**
 * Admin wallet that deploys and owns the Larry contracts.
 *
 * Use a fresh wallet that has never sent a transaction. Its first three transactions
 * deploy the pool, perps and options contracts, so their addresses are known in advance
 * from this address alone and the site needs no other configuration.
 *
 * Set VITE_LARRY_ADMIN, or paste the address here.
 */
const ADMIN_FALLBACK = ''

const raw = (env.VITE_LARRY_ADMIN as string | undefined) || ADMIN_FALLBACK
export const ADMIN: Address | null = raw && isAddress(raw) ? getAddress(raw) : null

const override = (v: string | undefined) => (v && isAddress(v) ? getAddress(v) : null)

export interface Addresses {
  pool: Address
  perps: Address
  options: Address
}

export const ADDRESSES: Addresses | null = ADMIN
  ? {
      pool: override(env.VITE_LARRY_POOL) ?? getContractAddress({ from: ADMIN, nonce: 0n }),
      perps: override(env.VITE_LARRY_PERPS) ?? getContractAddress({ from: ADMIN, nonce: 1n }),
      options: override(env.VITE_LARRY_OPTIONS) ?? getContractAddress({ from: ADMIN, nonce: 2n }),
    }
  : null

/**
 * Earlier options contracts that still hold open or unclaimed options, after options moved to a
 * new contract. Comma separated in VITE_LARRY_OPTIONS_LEGACY. Their positions stay claimable here.
 */
export const OPTIONS_LEGACY: Address[] = ((env.VITE_LARRY_OPTIONS_LEGACY as string | undefined) ?? '')
  .split(',')
  .map((a) => override(a.trim()))
  .filter((a): a is Address => !!a && a !== ADDRESSES?.options)

/** Nonce the admin wallet must have when it sends each deployment. */
export const DEPLOY_NONCE = { pool: 0, perps: 1, options: 2 } as const

/**
 * Paxos Global Dollar (USDG) on Robinhood Chain, per Paxos' docs. USDC bridged in arrives as USDG.
 * The admin page lets you change it before deploying; check it on the explorer first.
 */
export const DEFAULT_COLLATERAL: Address = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'

/** Onchain market id of an asset. */
export const marketIdOf = (symbol: string) => BigInt(ASSETS.find((a) => a.symbol === symbol)?.id ?? 0)

/** Optional RPC override, used for local testing against a Hardhat node. */
export const RPC_URL = (env.VITE_RPC_URL as string | undefined) || undefined
