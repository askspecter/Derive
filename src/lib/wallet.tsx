import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_CHAIN, chainById, type ChainConfig } from '../config/chains'

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, cb: (...args: any[]) => void): void
  removeListener?(event: string, cb: (...args: any[]) => void): void
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider
  }
}

interface WalletState {
  address: string | null
  chainId: number | null
  balance: number | null
  connecting: boolean
  error: string | null
  hasProvider: boolean
  onRobinhood: boolean
  connect(): Promise<void>
  disconnect(): void
  switchChain(chain?: ChainConfig): Promise<void>
}

const WalletContext = createContext<WalletState | null>(null)

const addParams = (c: ChainConfig) => ({
  chainId: c.hexId,
  chainName: c.name,
  nativeCurrency: c.nativeCurrency,
  rpcUrls: [c.rpcUrl],
  blockExplorerUrls: [c.explorerUrl],
})

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [balance, setBalance] = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const provider = typeof window !== 'undefined' ? window.ethereum : undefined

  const refreshBalance = useCallback(
    async (addr: string) => {
      if (!provider) return
      try {
        const hex = (await provider.request({ method: 'eth_getBalance', params: [addr, 'latest'] })) as string
        setBalance(Number(BigInt(hex)) / 1e18)
      } catch {
        setBalance(null)
      }
    },
    [provider],
  )

  const switchChain = useCallback(
    async (chain: ChainConfig = DEFAULT_CHAIN) => {
      if (!provider) return
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chain.hexId }] })
      } catch (e: any) {
        // 4902: chain not yet added to the wallet.
        if (e?.code === 4902 || e?.data?.originalError?.code === 4902) {
          await provider.request({ method: 'wallet_addEthereumChain', params: [addParams(chain)] })
        } else {
          setError(e?.message ?? 'Failed to switch network')
        }
      }
    },
    [provider],
  )

  const connect = useCallback(async () => {
    if (!provider) {
      setError('No wallet found. Install Robinhood Wallet, MetaMask or another EVM wallet.')
      return
    }
    setConnecting(true)
    setError(null)
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
      setAddress(accounts[0] ?? null)
      const id = parseInt((await provider.request({ method: 'eth_chainId' })) as string, 16)
      setChainId(id)
      if (!chainById(id)) await switchChain()
    } catch (e: any) {
      setError(e?.message ?? 'Connection rejected')
    } finally {
      setConnecting(false)
    }
  }, [provider, switchChain])

  const disconnect = useCallback(() => {
    setAddress(null)
    setBalance(null)
  }, [])

  useEffect(() => {
    if (!provider?.on) return
    const onAccounts = (accs: string[]) => setAddress(accs[0] ?? null)
    const onChain = (hex: string) => setChainId(parseInt(hex, 16))
    provider.on('accountsChanged', onAccounts)
    provider.on('chainChanged', onChain)
    provider
      .request({ method: 'eth_accounts' })
      .then((accs) => {
        const list = accs as string[]
        if (list[0]) {
          setAddress(list[0])
          return provider.request({ method: 'eth_chainId' }).then((h) => setChainId(parseInt(h as string, 16)))
        }
      })
      .catch(() => {})
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts)
      provider.removeListener?.('chainChanged', onChain)
    }
  }, [provider])

  useEffect(() => {
    if (address) refreshBalance(address)
  }, [address, chainId, refreshBalance])

  return (
    <WalletContext.Provider
      value={{
        address,
        chainId,
        balance,
        connecting,
        error,
        hasProvider: !!provider,
        onRobinhood: !!chainById(chainId),
        connect,
        disconnect,
        switchChain,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider')
  return ctx
}
