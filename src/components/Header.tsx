import { useState } from 'react'
import { SmartLink, SmartNavLink } from './SmartLink'
import { APP_ORIGIN, IS_APP_HOST, SPLIT_HOSTS } from '../config/site'
import { Logo } from './Logo'
import { WalletButton } from './WalletButton'
import { useWallet } from '../lib/wallet'
import { useProtocol } from '../lib/protocol'

const NAV = [
  { to: '/options', label: 'Options' },
  { to: '/perps', label: 'Perps' },
  { to: '/hyperliquid', label: 'Hyperliquid' },
  { to: '/vaults', label: 'Vaults' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/arena', label: 'Arena' },
  { to: '/stats', label: 'Stats' },
  { to: '/docs', label: 'Docs' },
]

export function Header() {
  const [open, setOpen] = useState(false)
  const { address } = useWallet()
  const p = useProtocol()
  const me = address?.toLowerCase()
  // Admin link only for the admin or current owner, or anyone while the site has no admin configured.
  const showAdmin = !p.configured || (!!me && (me === p.admin?.toLowerCase() || me === p.pool.owner?.toLowerCase()))
  // On larry.exchange the header links into the app instead of connecting a wallet there.
  const landing = SPLIT_HOSTS && !IS_APP_HOST
  const nav = showAdmin && !landing ? [...NAV, { to: '/admin', label: 'Admin' }] : NAV
  const action = landing ? (
    <a className="btn btn-accent" href={`${APP_ORIGIN}/#/perps`}>
      Launch app
    </a>
  ) : null
  return (
    <header className="header">
      <div className="header-inner">
        <SmartLink to="/" className="brand" onClick={() => setOpen(false)}>
          <Logo />
          <span>LARRY</span>
        </SmartLink>
        <nav className={open ? 'nav open' : 'nav'}>
          {nav.map((n) => (
            <SmartNavLink key={n.to} to={n.to} onClick={() => setOpen(false)}>
              {n.label}
            </SmartNavLink>
          ))}
          {/* On phones the wallet button lives inside the menu */}
          <div className="nav-wallet">
            {action ?? <WalletButton onAction={() => setOpen(false)} />}
          </div>
        </nav>
        <div className="header-actions">
          <div className="header-wallet">{action ?? <WalletButton />}</div>
          <button className="menu-btn" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
  )
}
