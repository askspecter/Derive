// The landing page lives on the root domain (larry.exchange), the trading app and admin on
// app.larry.exchange and the docs on docs.larry.exchange. Both are the same build: links and redirects pick the
// right host at runtime. Local, preview (vercel.app) and IP hosts keep everything on one host.

const host = typeof window !== 'undefined' ? window.location.hostname : ''
const single = !host.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.endsWith('.vercel.app') || host === 'localhost'
const root = host.replace(/^(www|app|docs)\./, '')

export const SPLIT_HOSTS = !single
export const IS_APP_HOST = host.startsWith('app.')
export const IS_DOCS_HOST = host.startsWith('docs.')
export const APP_ORIGIN = `https://app.${root}`
export const DOCS_ORIGIN = `https://docs.${root}`
export const SITE_ORIGIN = `https://${root}`

/** Routes that belong to the app host. */
export const APP_PATHS = ['/perps', '/options', '/vaults', '/portfolio', '/stats', '/arena', '/hyperliquid', '/admin']
export const isAppPath = (path: string) => APP_PATHS.some((p) => path === p || path.startsWith(p + '?'))
export const isDocsPath = (path: string) => path === '/docs' || path.startsWith('/docs/') || path.startsWith('/docs?')

/** The host a path belongs on: app, docs or the root site. */
const hostFor = (path: string) => (isAppPath(path) ? 'app' : isDocsPath(path) ? 'docs' : 'site')
const here = IS_APP_HOST ? 'app' : IS_DOCS_HOST ? 'docs' : 'site'
const ORIGIN = { app: APP_ORIGIN, docs: DOCS_ORIGIN, site: SITE_ORIGIN }

/** Where a path opened on the wrong host should go, or null when it belongs here. */
export const redirectUrl = (path: string) => (SPLIT_HOSTS && path !== '/' ? crossHostUrl(path) : null)

/** Absolute URL when a path lives on another host, otherwise null (use an in app link). */
export function crossHostUrl(path: string): string | null {
  if (!SPLIT_HOSTS) return null
  const h = hostFor(path)
  if (h === here) return null
  return path === '/' ? `${ORIGIN[h]}/` : `${ORIGIN[h]}/#${path}`
}
