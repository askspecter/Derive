import { useState } from 'react'
import { useConfig, useWriteContract } from 'wagmi'
import { readContract, waitForTransactionReceipt } from 'wagmi/actions'
import { useQueryClient } from '@tanstack/react-query'
import { erc20Abi, BaseError, ContractFunctionRevertedError, type Address } from 'viem'

export type TxStatus = { kind: 'idle' } | { kind: 'pending'; label: string } | { kind: 'done'; label: string } | { kind: 'error'; message: string }

/** Turns a viem error into one short readable line. */
export function errorMessage(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.reason
      if (name) return humanize(name)
    }
    if (/User rejected|denied/i.test(e.message)) return 'Request rejected in wallet.'
    return e.shortMessage
  }
  return e instanceof Error ? e.message : String(e)
}

const HUMAN: Record<string, string> = {
  InsufficientFreeLiquidity: 'Not enough free liquidity in the pool for this trade.',
  StalePrice: 'The oracle price is stale. The market may be closed.',
  SlippageExceeded: 'Price moved beyond your slippage limit. Try again.',
  BadLeverage: 'Leverage is outside the allowed range.',
  CollateralTooSmall: 'Collateral is below the minimum.',
  OpenInterestCap: 'This market reached its open interest cap.',
  NotionalCap: 'This options market reached its open notional cap.',
  PremiumTooHigh: 'The premium moved above your limit. Try again.',
  Paused: 'Trading is paused.',
  MarketDisabled: 'This market is not listed.',
  NotLiquidatable: 'This position is not liquidatable.',
  BadRound: 'That oracle round cannot settle this expiry.',
  NotExpired: 'Not expired yet.',
  AlreadySettled: 'Already settled.',
  NotSettled: 'This expiry is not settled yet.',
  ERC4626ExceededMaxDeposit: 'Deposit is above the pool cap.',
  ERC4626ExceededMaxWithdraw: 'Withdrawal is above what is unlocked and free.',
  ERC4626ExceededMaxRedeem: 'Withdrawal is above what is unlocked and free.',
  OwnableUnauthorizedAccount: 'Only the admin wallet can do this.',
  BadParams: 'Invalid parameters.',
}
const humanize = (name: string) => HUMAN[name] ?? name

/**
 * Runs contract writes one after another, waiting for each receipt, then refreshes all reads.
 * `ensureAllowance` approves exactly the amount needed when the current allowance is short.
 */
export function useTx() {
  const config = useConfig()
  const qc = useQueryClient()
  const { writeContractAsync } = useWriteContract()
  const [status, setStatus] = useState<TxStatus>({ kind: 'idle' })

  async function write(label: string, params: Parameters<typeof writeContractAsync>[0]) {
    setStatus({ kind: 'pending', label: `${label}: confirm in your wallet` })
    const hash = await writeContractAsync(params)
    setStatus({ kind: 'pending', label: `${label}: waiting for confirmation` })
    const receipt = await waitForTransactionReceipt(config, { hash })
    if (receipt.status !== 'success') throw new Error(`${label} failed onchain`)
    return receipt
  }

  async function ensureAllowance(token: Address, owner: Address, spender: Address, amount: bigint, symbol: string) {
    const allowance = await readContract(config, { address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] })
    if (allowance >= amount) return
    await write(`Approve ${symbol}`, { address: token, abi: erc20Abi, functionName: 'approve', args: [spender, amount] })
  }

  /** Wraps a multi step flow with status handling. Returns true on success. */
  async function run(doneLabel: string, flow: () => Promise<unknown>) {
    try {
      await flow()
      setStatus({ kind: 'done', label: doneLabel })
      await qc.invalidateQueries()
      return true
    } catch (e) {
      setStatus({ kind: 'error', message: errorMessage(e) })
      return false
    }
  }

  return { status, setStatus, write, ensureAllowance, run, busy: status.kind === 'pending' }
}
