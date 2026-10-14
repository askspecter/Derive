import { createContext, useContext, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider, useBalance, useSwitchChain } from 'wagmi'
import { useAppKit, useAppKitAccount, useAppKitNetwork, useDisconnect } from '@reown/appkit/react'
import { robinhood } from '@reown/appkit/networks'
import { appKit, wagmiAdapter } from './reown'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { errorMessage } from './tx'

// Wallet connection runs through Reown AppKit. This context keeps the small
// interface the rest of the app uses, so pages never touch AppKit directly.

interface WalletState {
  address: string | null
  chainId: number | null
  balance: number | null
  connecting: boolean
  onRobinhood: boolean
  switching: boolean
  switchError: string | null
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
  const { chainId } = useAppKitNetwork()
  const { switchChainAsync } = useSwitchChain()
  const [switching, setSwitching] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)
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
    switching,
    switchError,
    switchChain: async () => {
      setSwitching(true)
      setSwitchError(null)
      try {
        // Asks the wallet to switch, and to add Robinhood Chain first if it doesn't know it.
        await switchChainAsync({
          chainId: robinhood.id,
          addEthereumChainParameter: {
            chainName: ROBINHOOD_CHAIN.name,
            nativeCurrency: ROBINHOOD_CHAIN.nativeCurrency,
            rpcUrls: [ROBINHOOD_CHAIN.rpcUrl],
            blockExplorerUrls: [ROBINHOOD_CHAIN.explorerUrl],
          },
        })
      } catch (e) {
        setSwitchError(errorMessage(e))
      } finally {
        setSwitching(false)
      }
    },
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
