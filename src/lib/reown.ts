import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { robinhood } from '@reown/appkit/networks'
import type { AppKitNetwork } from '@reown/appkit/networks'
import { http } from 'wagmi'
import { RPC_URL } from '../config/protocol'

// Get a project ID at https://dashboard.reown.com and put it in .env as VITE_REOWN_PROJECT_ID.
export const projectId = import.meta.env.VITE_REOWN_PROJECT_ID as string | undefined

if (!projectId) {
  console.warn('VITE_REOWN_PROJECT_ID is not set. Mobile wallets via QR code will not connect until it is.')
}

// Larry runs on Robinhood Chain mainnet only (chain ID 4663).
export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [robinhood]

const rpcUrl = RPC_URL ?? robinhood.rpcUrls.default.http[0]
const customRpcUrls = { [`eip155:${robinhood.id}`]: [{ url: rpcUrl }] }

export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId: projectId ?? 'missing-project-id',
  transports: { [robinhood.id]: http(rpcUrl, { batch: true }) },
  customRpcUrls,
})

export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks,
  defaultNetwork: robinhood,
  projectId: projectId ?? 'missing-project-id',
  // Don't lock the screen when the wallet is on another network: the site shows its own
  // banner with a switch button and manual setup steps (some mobile wallets can't auto add chains).
  allowUnsupportedChain: true,
  chainImages: { [robinhood.id]: typeof window !== 'undefined' ? `${window.location.origin}/tokens/eth.png` : '' },
  customRpcUrls,
  metadata: {
    name: 'Larry',
    description: 'Take the edge back. Derivatives for everyone on Robinhood Chain.',
    url: typeof window !== 'undefined' ? window.location.origin : 'https://www.larry.exchange',
    icons: [typeof window !== 'undefined' ? `${window.location.origin}/apple-touch-icon.png` : ''],
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
    swaps: false,
    onramp: false,
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#5bfcc0',
    '--w3m-color-mix': '#000000',
    '--w3m-color-mix-strength': 40,
    '--w3m-font-family': "'Geist', system-ui, sans-serif",
    '--w3m-border-radius-master': '3px',
    '--w3m-z-index': 100,
  },
})
