import { Link } from 'react-router-dom'
import { ROBINHOOD_CHAIN } from '../config/chains'
import { Logo } from './Logo'

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <div className="brand">
            <Logo size={24} />
            <span>Larry</span>
          </div>
          <p className="muted small">
            Onchain options, perps and structured yield, settled on Robinhood Chain — an Arbitrum Orbit L2 secured by
            Ethereum.
          </p>
        </div>
        <div>
          <h4>Trade</h4>
          <Link to="/options">Options</Link>
          <Link to="/perps">Perpetuals</Link>
          <Link to="/vaults">Vaults</Link>
        </div>
        <div>
          <h4>Network</h4>
          <a href={ROBINHOOD_CHAIN.explorerUrl} target="_blank" rel="noreferrer">
            Block explorer
          </a>
          <a href="https://docs.robinhood.com/chain/connecting" target="_blank" rel="noreferrer">
            Robinhood Chain docs
          </a>
        </div>
        <div>
          <h4>Protocol</h4>
          <Link to="/stats">Stats</Link>
          <Link to="/portfolio">Portfolio</Link>
        </div>
      </div>
      <div className="container footer-note small muted">
        Larry is an independent project and is not affiliated with Robinhood Markets, Inc. Prices shown are a
        simulated oracle and trades are paper positions until contracts are deployed. Derivatives carry significant
        risk.
      </div>
    </footer>
  )
}
