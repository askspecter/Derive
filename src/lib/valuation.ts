import { assetBySymbol, VAULTS } from '../config/markets'
import { blackScholes, smileVol } from './blackScholes'
import type { OptionPosition, PerpPosition, VaultPosition } from './account'

const YEAR_MS = 365 * 24 * 3600 * 1000

export function optionMark(p: OptionPosition, spot: number, now = Date.now()) {
  const years = (p.expiry - now) / YEAR_MS
  if (years <= 0) {
    return p.type === 'call' ? Math.max(spot - p.strike, 0) : Math.max(p.strike - spot, 0)
  }
  const vol = smileVol(assetBySymbol(p.asset).vol, spot, p.strike, years)
  return blackScholes(p.type, spot, p.strike, years, vol).price
}

export function optionPnl(p: OptionPosition, mark: number) {
  return (p.side === 'buy' ? 1 : -1) * (mark - p.entry) * p.size
}

export function perpPnl(p: PerpPosition, mark: number) {
  return (p.side === 'long' ? 1 : -1) * (mark - p.entry) * p.size
}

// Price at which remaining margin hits the 5% maintenance requirement.
export function perpLiquidation(p: { side: 'long' | 'short'; entry: number; leverage: number }) {
  const buffer = 1 / p.leverage - 0.05
  return p.side === 'long' ? p.entry * (1 - buffer) : p.entry * (1 + buffer)
}

export function vaultValue(v: VaultPosition, now = Date.now()) {
  const apy = VAULTS.find((x) => x.id === v.vaultId)?.apy ?? 0
  return v.amount * (1 + apy * ((now - v.depositedAt) / YEAR_MS))
}
