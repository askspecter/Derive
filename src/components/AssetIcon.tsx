import { assetBySymbol } from '../config/markets'

export function AssetIcon({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const a = assetBySymbol(symbol)
  return <img className="asset-icon" src={a.logo} alt={a.symbol} width={size} height={size} loading="lazy" />
}
