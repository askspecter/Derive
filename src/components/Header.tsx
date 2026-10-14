import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Logo } from './Logo'
import { WalletButton } from './WalletButton'

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
  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <Logo />
          <span>LARRY</span>
        </Link>
        <nav className={open ? 'nav open' : 'nav'}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} onClick={() => setOpen(false)}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          <WalletButton />
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
