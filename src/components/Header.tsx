import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Logo } from './Logo'
import { WalletButton } from './WalletButton'
import { useWallet } from '../lib/wallet'
import { useProtocol } from '../lib/protocol'

const NAV = [
  { to: '/options', label: 'Options' },
  { to: '/perps', label: 'Perps' },
  { to: '/vaults', label: 'Vaults' },
  { to: '/portfolio', label: 'Portfolio' },
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
  const nav = showAdmin ? [...NAV, { to: '/admin', label: 'Admin' }] : NAV
  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <Logo />
          <span>LARRY</span>
        </Link>
        <nav className={open ? 'nav open' : 'nav'}>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} onClick={() => setOpen(false)}>
              {n.label}
            </NavLink>
          ))}
          {/* On phones the wallet button lives inside the menu */}
          <div className="nav-wallet">
            <WalletButton onAction={() => setOpen(false)} />
          </div>
        </nav>
        <div className="header-actions">
          <div className="header-wallet">
            <WalletButton />
          </div>
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
