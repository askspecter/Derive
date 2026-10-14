import { Link } from 'react-router-dom'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { Logo } from './Logo'

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <div className="brand">
            <Logo />
            <span>LARRY</span>
          </div>
          <p className="eyebrow">
            Take the edge back
            <br />
            Derivatives for everyone
          </p>
        </div>
        <div>
          <h4>Trade</h4>
          <Link to="/options">Options</Link>
          <Link to="/perps">Perpetuals</Link>
          <Link to="/vaults">Vaults</Link>
          <Link to="/portfolio">Portfolio</Link>
        </div>
        <div>
          <h4>Learn</h4>
          <Link to="/docs">Docs</Link>
          <Link to="/docs/fees">Fees</Link>
          <Link to="/docs/risks">Risks</Link>
          <Link to="/stats">Stats</Link>
        </div>
        <div>
          <h4>Network</h4>
          <a href={ROBINHOOD_CHAIN.explorerUrl} target="_blank" rel="noreferrer">
            Block explorer
          </a>
          <a href="https://docs.robinhood.com/chain/connecting" target="_blank" rel="noreferrer">
            Robinhood Chain
          </a>
        </div>
      </div>
      <div className="container footer-note">
        <span>© {new Date().getFullYear()} Larry</span>
        <span>
          Independent project, not affiliated with Robinhood Markets, Inc. Contracts are unaudited. Trade at your own
          risk.
        </span>
      </div>
    </footer>
  )
}
