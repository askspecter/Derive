import { getAddress, isAddress, type Address } from 'viem'
import { ADMIN } from './protocol'

const env = import.meta.env

/** Hyperliquid testnet instead of mainnet, for trying the integration with test funds. */
export const HL_TESTNET = env.VITE_HL_TESTNET === '1' || env.VITE_HL_TESTNET === 'true'

/**
 * Builder address that earns Larry's builder fee on Hyperliquid orders placed here.
 * Hyperliquid only pays a builder that holds at least 100 USDC in its perps account.
 * Defaults to the Larry admin wallet.
 */
const rawBuilder = (env.VITE_HL_BUILDER as string | undefined) ?? ''
export const HL_BUILDER: Address | null = rawBuilder && isAddress(rawBuilder) ? getAddress(rawBuilder) : ADMIN

/** Builder fee in tenths of a basis point (Hyperliquid's unit): 50 = 0.05%. Hyperliquid caps perps at 100 (0.1%). */
export const HL_BUILDER_FEE = Math.min(100, Math.max(0, Number(env.VITE_HL_BUILDER_FEE ?? 50) || 0))
/** The same fee as the percent string traders approve, for example "0.05%". */
export const HL_BUILDER_FEE_PCT = `${HL_BUILDER_FEE / 1000}%`

export const HL_APP = HL_TESTNET ? 'https://app.hyperliquid-testnet.xyz' : 'https://app.hyperliquid.xyz'
/** Market order slippage limit. */
export const HL_SLIPPAGE = 0.01
