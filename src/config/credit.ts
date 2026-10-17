import { encodeAbiParameters, getAddress, isAddress, keccak256, type Address } from 'viem'
import { ADDRESSES, DEFAULT_COLLATERAL } from './protocol'

const env = import.meta.env

/** Morpho Blue on Robinhood Chain and its AdaptiveCurve interest rate model (the ones EmpireX's credit markets use). */
export const MORPHO: Address = '0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010'
export const MORPHO_IRM: Address = '0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1'
/** Borrow up to 62.5% of the LLP posted, the same LLTV as the NVDA market on Morpho here. */
export const LLP_LLTV = 625000000000000000n

/** LarryVaultOracle deployed from the admin page. With it set, the LLP / USDG credit market is live on the site. */
const o = (env.VITE_LLP_ORACLE as string | undefined) ?? ''
export const LLP_ORACLE: Address | null = isAddress(o) ? getAddress(o) : null

export function llpMarket(oracle: Address | null = LLP_ORACLE, loan: Address = DEFAULT_COLLATERAL) {
  if (!oracle || !ADDRESSES) return null
  const params = { loanToken: loan, collateralToken: ADDRESSES.pool, oracle, irm: MORPHO_IRM, lltv: LLP_LLTV } as const
  const id = keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }], [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv]),
  )
  return { params, id }
}

export const MorphoAbi = [
  { type: 'function', name: 'createMarket', stateMutability: 'nonpayable', inputs: [{ name: 'marketParams', type: 'tuple', components: [{ name: 'loanToken', type: 'address' }, { name: 'collateralToken', type: 'address' }, { name: 'oracle', type: 'address' }, { name: 'irm', type: 'address' }, { name: 'lltv', type: 'uint256' }] }], outputs: [] },
  ...(['supply', 'withdraw', 'borrow', 'repay'] as const).map((name) => ({
    type: 'function' as const,
    name,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'marketParams', type: 'tuple', components: [{ name: 'loanToken', type: 'address' }, { name: 'collateralToken', type: 'address' }, { name: 'oracle', type: 'address' }, { name: 'irm', type: 'address' }, { name: 'lltv', type: 'uint256' }] },
      { name: 'assets', type: 'uint256' },
      { name: 'shares', type: 'uint256' },
      { name: 'onBehalf', type: 'address' },
      name === 'supply' || name === 'repay' ? { name: 'data', type: 'bytes' } : { name: 'receiver', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }, { name: '', type: 'uint256' }],
  })),
  { type: 'function', name: 'supplyCollateral', stateMutability: 'nonpayable', inputs: [{ name: 'marketParams', type: 'tuple', components: [{ name: 'loanToken', type: 'address' }, { name: 'collateralToken', type: 'address' }, { name: 'oracle', type: 'address' }, { name: 'irm', type: 'address' }, { name: 'lltv', type: 'uint256' }] }, { name: 'assets', type: 'uint256' }, { name: 'onBehalf', type: 'address' }, { name: 'data', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'withdrawCollateral', stateMutability: 'nonpayable', inputs: [{ name: 'marketParams', type: 'tuple', components: [{ name: 'loanToken', type: 'address' }, { name: 'collateralToken', type: 'address' }, { name: 'oracle', type: 'address' }, { name: 'irm', type: 'address' }, { name: 'lltv', type: 'uint256' }] }, { name: 'assets', type: 'uint256' }, { name: 'onBehalf', type: 'address' }, { name: 'receiver', type: 'address' }], outputs: [] },
  { type: 'function', name: 'market', stateMutability: 'view', inputs: [{ name: 'id', type: 'bytes32' }], outputs: [{ name: 'totalSupplyAssets', type: 'uint128' }, { name: 'totalSupplyShares', type: 'uint128' }, { name: 'totalBorrowAssets', type: 'uint128' }, { name: 'totalBorrowShares', type: 'uint128' }, { name: 'lastUpdate', type: 'uint128' }, { name: 'fee', type: 'uint128' }] },
  { type: 'function', name: 'position', stateMutability: 'view', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'user', type: 'address' }], outputs: [{ name: 'supplyShares', type: 'uint256' }, { name: 'borrowShares', type: 'uint128' }, { name: 'collateral', type: 'uint128' }] },
] as const

export const IrmAbi = [
  {
    type: 'function',
    name: 'borrowRateView',
    stateMutability: 'view',
    inputs: [
      { name: 'marketParams', type: 'tuple', components: [{ name: 'loanToken', type: 'address' }, { name: 'collateralToken', type: 'address' }, { name: 'oracle', type: 'address' }, { name: 'irm', type: 'address' }, { name: 'lltv', type: 'uint256' }] },
      { name: 'market', type: 'tuple', components: [{ name: 'totalSupplyAssets', type: 'uint128' }, { name: 'totalSupplyShares', type: 'uint128' }, { name: 'totalBorrowAssets', type: 'uint128' }, { name: 'totalBorrowShares', type: 'uint128' }, { name: 'lastUpdate', type: 'uint128' }, { name: 'fee', type: 'uint128' }] },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const
