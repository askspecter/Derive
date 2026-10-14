// Injected EIP-1193 wallet for browser tests. Forwards everything to a local Hardhat node,
// whose accounts are unlocked, and announces itself through EIP-6963 so Reown lists it.
;(() => {
  const RPC = window.__E2E_RPC || 'http://127.0.0.1:8545'
  let account = window.__E2E_ACCOUNT
  const listeners = {}
  async function rpc(method, params = []) {
    const r = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    })
    const j = await r.json()
    if (j.error) {
      const e = new Error(j.error.message)
      e.code = j.error.code
      e.data = j.error.data
      throw e
    }
    return j.result
  }
  const provider = {
    isMetaMask: true,
    async request({ method, params }) {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [account]
        case 'eth_chainId':
          return '0x1237'
        case 'net_version':
          return '4663'
        case 'wallet_switchEthereumChain':
        case 'wallet_addEthereumChain':
          return null
        case 'wallet_requestPermissions':
        case 'wallet_getPermissions':
          return [{ parentCapability: 'eth_accounts' }]
        case 'eth_sendTransaction':
          return rpc('eth_sendTransaction', [{ ...params[0], from: account }])
        default:
          return rpc(method, params || [])
      }
    },
    on(e, cb) {
      ;(listeners[e] ||= []).push(cb)
    },
    removeListener(e, cb) {
      listeners[e] = (listeners[e] || []).filter((x) => x !== cb)
    },
  }
  window.ethereum = provider
  window.__setAccount = (a) => {
    account = a
    ;(listeners.accountsChanged || []).forEach((cb) => cb([a]))
  }
  const info = {
    uuid: '6f1c8a2e-0000-4000-8000-000000000e2e',
    name: 'E2E Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=',
    rdns: 'io.larry.e2e',
  }
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
})()
