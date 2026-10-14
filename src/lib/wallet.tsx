import { createContext, useContext, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, useBalance } from 'wagmi'
import { useAppKit, useAppKitAccount, useAppKitNetwork, useDisconnect } from '@reown/appkit/react'
import { robinhood } from '@reown/appkit/networks'
import { appKit, wagmiAdapter } from './reown'

// Wallet connection runs through Reown AppKit. This context keeps the small
// interface the rest of the app uses, so pages never touch AppKit directly.

interface WalletState {
  address: string | null
  chainId: number | null
  balance: number | null
  connecting: boolean
  onRobinhood: boolean
  connect(): void
  openAccount(): void
  disconnect(): void
  switchChain(): void
}

const WalletContext = createContext<WalletState | null>(null)
const queryClient = new QueryClient()

function WalletBridge({ children }: { children: ReactNode }) {
  const { open } = useAppKit()
  const { address, isConnected, status } = useAppKitAccount()
  const { chainId, switchNetwork } = useAppKitNetwork()
  const { disconnect } = useDisconnect()
  const id = chainId == null ? null : Number(chainId)
  const { data: bal } = useBalance({
    address: address as `0x${string}` | undefined,
    chainId: robinhood.id,
    query: { enabled: !!address },
  })

  const value: WalletState = {
    address: isConnected && address ? address : null,
    chainId: id,
    balance: bal ? Number(bal.value) / 10 ** bal.decimals : null,
    connecting: status === 'connecting' || status === 'reconnecting',
    onRobinhood: id === robinhood.id,
    connect: () => open({ view: 'Connect' }),
    openAccount: () => open({ view: 'Account' }),
    disconnect: () => disconnect(),
    switchChain: () => switchNetwork(robinhood),
  }

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletBridge>{children}</WalletBridge>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used inside WalletProvider')
  return ctx
}

export { appKit }
