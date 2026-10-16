// The landing page and docs live on the root domain (larry.exchange); the trading app and
// admin live on app.larry.exchange. Both are the same build: links and redirects pick the
// right host at runtime. Local, preview (vercel.app) and IP hosts keep everything on one host.

const host = typeof window !== 'undefined' ? window.location.hostname : ''
const single = !host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.endsWith('.vercel.app') || host === 'localhost'
const root = host.replace(/^(www|app)\./, '')

export const SPLIT_HOSTS = !single
export const IS_APP_HOST = host.startsWith('app.')
export const APP_ORIGIN = `https://app.${root}`
export const SITE_ORIGIN = `https://${root}`

/** Routes that belong to the app host. */
export const APP_PATHS = ['/perps', '/options', '/vaults', '/portfolio', '/stats', '/arena', '/hyperliquid', '/admin']
export const isAppPath = (path: string) => APP_PATHS.some((p) => path === p || path.startsWith(p + '?'))

/** Absolute URL when a path lives on the other host, otherwise null (use an in app link). */
export function crossHostUrl(path: string): string | null {
  if (!SPLIT_HOSTS) return null
  if (isAppPath(path)) return IS_APP_HOST ? null : `${APP_ORIGIN}/#${path}`
  if (path === '/') return IS_APP_HOST ? `${SITE_ORIGIN}/` : null
  return null
}
