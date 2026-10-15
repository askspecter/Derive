import { SmartLink as Link } from './SmartLink'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { Logo } from './Logo'
import { TokenCA } from './TokenCA'

export const X_URL = 'https://x.com/larryexchange_'

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

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
          <div className="footer-token">
            <span className="eyebrow">$LARRY</span>
            <TokenCA compact />
          </div>
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
          <h4>Community</h4>
          <a href={X_URL} target="_blank" rel="noreferrer" className="social">
            <XIcon /> @larryexchange_
          </a>
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
