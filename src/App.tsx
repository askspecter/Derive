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
import { IS_APP_HOST, IS_DOCS_HOST, SPLIT_HOSTS, redirectUrl } from './config/site'
import { Admin } from './pages/Admin'
import { Arena } from './pages/Arena'
import { Hyperliquid } from './pages/Hyperliquid'
import { BurnPage } from './pages/Burn'

/** Sends a route opened on the wrong host to its own: app routes to app., docs to docs., the rest to the root site. */
function HostRouting() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    const url = redirectUrl(pathname + search)
    if (url) window.location.replace(url)
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
                <Route path="/" element={SPLIT_HOSTS && IS_APP_HOST ? <Navigate to="/perps" replace /> : SPLIT_HOSTS && IS_DOCS_HOST ? <Navigate to="/docs" replace /> : <Home />} />
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
