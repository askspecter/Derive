import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useWallet } from './wallet'
import type { OptionType } from './blackScholes'

// Paper-trading account. Positions live in localStorage until the Sherwood
// contracts are deployed on Robinhood Chain; the shape mirrors the onchain
// subaccount so the UI can be swapped to contract reads later.

export type Side = 'buy' | 'sell'

export interface OptionPosition {
  id: string
  kind: 'option'
  asset: string
  type: OptionType
  strike: number
  expiry: number
  side: Side
  size: number
  entry: number
  openedAt: number
}

export interface PerpPosition {
  id: string
  kind: 'perp'
  asset: string
  side: 'long' | 'short'
  size: number
  entry: number
  leverage: number
  openedAt: number
}

export interface VaultPosition {
  vaultId: string
  amount: number
  depositedAt: number
}

export interface Trade {
  id: string
  label: string
  side: string
  size: number
  price: number
  at: number
}

interface AccountData {
  cash: number
  options: OptionPosition[]
  perps: PerpPosition[]
  vaults: VaultPosition[]
  history: Trade[]
}

interface AccountState extends AccountData {
  openOption(p: Omit<OptionPosition, 'id' | 'kind' | 'openedAt'>): string | null
  openPerp(p: Omit<PerpPosition, 'id' | 'kind' | 'openedAt'>): string | null
  closeOption(id: string, mark: number): void
  closePerp(id: string, mark: number): void
  depositVault(vaultId: string, amount: number): string | null
  withdrawVault(vaultId: string, value: number): void
  reset(): void
}

const STARTING_CASH = 25_000
const empty = (): AccountData => ({ cash: STARTING_CASH, options: [], perps: [], vaults: [], history: [] })
const uid = () => Math.random().toString(36).slice(2, 10)

function load(key: string): AccountData {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return { ...empty(), ...JSON.parse(raw) }
  } catch {}
  return empty()
}

const AccountContext = createContext<AccountState | null>(null)

export function AccountProvider({ children }: { children: ReactNode }) {
  const { address } = useWallet()
  const key = `sherwood:account:${address?.toLowerCase() ?? 'guest'}`
  const [data, setData] = useState<AccountData>(() => load(key))

  useEffect(() => setData(load(key)), [key])
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(data))
    } catch {}
  }, [key, data])

  const log = (d: AccountData, t: Omit<Trade, 'id' | 'at'>): Trade[] =>
    [{ ...t, id: uid(), at: Date.now() }, ...d.history].slice(0, 100)

  const openOption: AccountState['openOption'] = useCallback(
    (p) => {
      const premium = p.entry * p.size
      // Buyers pay premium; sellers post 20% of notional as margin and receive premium.
      const cost = p.side === 'buy' ? premium : p.strike * p.size * 0.2 - premium
      if (cost > data.cash) return 'Insufficient margin'
      setData((d) => ({
        ...d,
        cash: d.cash - cost,
        options: [...d.options, { ...p, id: uid(), kind: 'option', openedAt: Date.now() }],
        history: log(d, {
          label: `${p.asset} ${new Date(p.expiry).toISOString().slice(0, 10)} ${p.strike} ${p.type.toUpperCase()}`,
          side: p.side,
          size: p.size,
          price: p.entry,
        }),
      }))
      return null
    },
    [data.cash],
  )

  const closeOption = useCallback((id: string, mark: number) => {
    setData((d) => {
      const p = d.options.find((o) => o.id === id)
      if (!p) return d
      const margin = p.side === 'sell' ? p.strike * p.size * 0.2 : 0
      const back = p.side === 'buy' ? mark * p.size : margin - mark * p.size
      return {
        ...d,
        cash: d.cash + back,
        options: d.options.filter((o) => o.id !== id),
        history: log(d, {
          label: `${p.asset} ${p.strike} ${p.type.toUpperCase()} close`,
          side: p.side === 'buy' ? 'sell' : 'buy',
          size: p.size,
          price: mark,
        }),
      }
    })
  }, [])

  const openPerp: AccountState['openPerp'] = useCallback(
    (p) => {
      const margin = (p.size * p.entry) / p.leverage
      const fee = p.size * p.entry * 0.0003
      if (margin + fee > data.cash) return 'Insufficient margin'
      setData((d) => ({
        ...d,
        cash: d.cash - margin - fee,
        perps: [...d.perps, { ...p, id: uid(), kind: 'perp', openedAt: Date.now() }],
        history: log(d, { label: `${p.asset}-PERP ${p.leverage}x`, side: p.side, size: p.size, price: p.entry }),
      }))
      return null
    },
    [data.cash],
  )

  const closePerp = useCallback((id: string, mark: number) => {
    setData((d) => {
      const p = d.perps.find((o) => o.id === id)
      if (!p) return d
      const dir = p.side === 'long' ? 1 : -1
      const pnl = dir * (mark - p.entry) * p.size
      const margin = (p.size * p.entry) / p.leverage
      return {
        ...d,
        cash: d.cash + Math.max(margin + pnl, 0),
        perps: d.perps.filter((o) => o.id !== id),
        history: log(d, {
          label: `${p.asset}-PERP close`,
          side: p.side === 'long' ? 'short' : 'long',
          size: p.size,
          price: mark,
        }),
      }
    })
  }, [])

  const depositVault = useCallback(
    (vaultId: string, amount: number) => {
      if (amount <= 0) return 'Enter an amount'
      if (amount > data.cash) return 'Insufficient balance'
      setData((d) => {
        const existing = d.vaults.find((v) => v.vaultId === vaultId)
        const vaults = existing
          ? d.vaults.map((v) => (v.vaultId === vaultId ? { ...v, amount: v.amount + amount } : v))
          : [...d.vaults, { vaultId, amount, depositedAt: Date.now() }]
        return { ...d, cash: d.cash - amount, vaults, history: log(d, { label: `Vault ${vaultId}`, side: 'deposit', size: amount, price: 1 }) }
      })
      return null
    },
    [data.cash],
  )

  const withdrawVault = useCallback((vaultId: string, value: number) => {
    setData((d) => {
      const v = d.vaults.find((x) => x.vaultId === vaultId)
      if (!v) return d
      return {
        ...d,
        cash: d.cash + value,
        vaults: d.vaults.filter((x) => x.vaultId !== vaultId),
        history: log(d, { label: `Vault ${vaultId}`, side: 'withdraw', size: value, price: 1 }),
      }
    })
  }, [])

  const reset = useCallback(() => setData(empty()), [])

  return (
    <AccountContext.Provider
      value={{ ...data, openOption, openPerp, closeOption, closePerp, depositVault, withdrawVault, reset }}
    >
      {children}
    </AccountContext.Provider>
  )
}

export function useAccount() {
  const ctx = useContext(AccountContext)
  if (!ctx) throw new Error('useAccount must be used inside AccountProvider')
  return ctx
}
