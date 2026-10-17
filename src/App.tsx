import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Header } from './components/Header'
import { WrongNetwork } from './components/WrongNetwork'
import { Footer } from './components/Footer'
import { Home } from './pages/Home'
import { Options } from './pages/Options'
import { Perps } from './pages/Perps'
import { Vaults } from './pages/Vaults'
import { Portfolio } from './pages/Portfolio'
import { Stats } from './pages/Stats'
import { Docs } from './pages/Docs'
import { WalletProvider } from './lib/wallet'
import { ProtocolProvider } from './lib/protocol'
import { APP_ORIGIN, IS_APP_HOST, SPLIT_HOSTS, isAppPath } from './config/site'
import { Admin } from './pages/Admin'
import { Arena } from './pages/Arena'
import { Hyperliquid } from './pages/Hyperliquid'
import { BurnPage } from './pages/Burn'

/** Sends app routes opened on larry.exchange over to app.larry.exchange. */
function HostRouting() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    if (SPLIT_HOSTS && !IS_APP_HOST && isAppPath(pathname)) window.location.replace(`${APP_ORIGIN}/#${pathname}${search}`)
  }, [pathname, search])
  return null
}

function ScrollTop() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return null
}

export default function App() {
  return (
    <WalletProvider>
      <ProtocolProvider>
          <HashRouter>
            <ScrollTop />
            <HostRouting />
            <Header />
            <WrongNetwork />
            <main>
              <Routes>
                <Route path="/" element={SPLIT_HOSTS && IS_APP_HOST ? <Navigate to="/perps" replace /> : <Home />} />
                <Route path="/options" element={<Options />} />
                <Route path="/perps" element={<Perps />} />
                <Route path="/vaults" element={<Vaults />} />
                <Route path="/portfolio" element={<Portfolio />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/arena" element={<Arena />} />
                <Route path="/hyperliquid" element={<Hyperliquid />} />
                <Route path="/burn" element={<BurnPage />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/docs" element={<Docs />} />
                <Route path="/docs/:slug" element={<Docs />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
            <Footer />
          </HashRouter>
      </ProtocolProvider>
    </WalletProvider>
  )
}
