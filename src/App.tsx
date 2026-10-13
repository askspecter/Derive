import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { Home } from './pages/Home'
import { Options } from './pages/Options'
import { Perps } from './pages/Perps'
import { Vaults } from './pages/Vaults'
import { Portfolio } from './pages/Portfolio'
import { Stats } from './pages/Stats'
import { WalletProvider } from './lib/wallet'
import { MarketProvider } from './lib/market'
import { AccountProvider } from './lib/account'

function ScrollTop() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return null
}

export default function App() {
  return (
    <WalletProvider>
      <MarketProvider>
        <AccountProvider>
          <HashRouter>
            <ScrollTop />
            <Header />
            <main>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/options" element={<Options />} />
                <Route path="/perps" element={<Perps />} />
                <Route path="/vaults" element={<Vaults />} />
                <Route path="/portfolio" element={<Portfolio />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
            <Footer />
          </HashRouter>
        </AccountProvider>
      </MarketProvider>
    </WalletProvider>
  )
}
