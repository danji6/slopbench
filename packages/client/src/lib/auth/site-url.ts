const DEFAULT_AUTH_SITE_URL = 'http://localhost:3211'
const DEFAULT_CONVEX_URL = 'http://localhost:3210'

type AuthSiteEnv = {
  CURRENT_ORIGIN?: string
  VITE_CONVEX_SITE_URL?: string
  VITE_CONVEX_URL?: string
}

type ConvexClientEnv = {
  CURRENT_ORIGIN?: string
  VITE_CONVEX_URL?: string
}

export function normalizeBrowserUrl(
  url: string | null | undefined,
  currentOrigin = window.location.origin,
): string | null {
  if (!url) return null

  return normalizeLocalUrl(new URL(url), currentOrigin)
}

export function getConvexClientUrl(env: ConvexClientEnv): string {
  return normalizeLocalUrl(
    new URL(env.VITE_CONVEX_URL ?? DEFAULT_CONVEX_URL),
    env.CURRENT_ORIGIN,
  )
}

export function getAuthSiteUrl(env: AuthSiteEnv): string {
  if (env.VITE_CONVEX_SITE_URL) {
    return normalizeSiteUrl(env.VITE_CONVEX_SITE_URL, env.CURRENT_ORIGIN)
  }

  return getConvexSiteUrl(env.VITE_CONVEX_URL, env.CURRENT_ORIGIN)
}

function getConvexSiteUrl(
  convexUrl: string | undefined,
  currentOrigin: string | undefined,
): string {
  if (!convexUrl) return normalizeSiteUrl(DEFAULT_AUTH_SITE_URL, currentOrigin)

  const url = new URL(convexUrl)

  if (isLocalConvexBackend(url)) {
    url.port = '3211'
    return normalizeLocalUrl(url, currentOrigin)
  }

  if (url.hostname.endsWith('.convex.cloud')) {
    url.hostname = url.hostname.replace(/\.convex\.cloud$/, '.convex.site')
  }

  return normalizeUrl(url)
}

function normalizeSiteUrl(
  siteUrl: string,
  currentOrigin: string | undefined,
): string {
  return normalizeLocalUrl(new URL(siteUrl), currentOrigin)
}

function normalizeLocalUrl(
  url: URL,
  currentOrigin: string | undefined,
): string {
  if (isLoopbackHostname(url.hostname) && currentOrigin) {
    const currentUrl = new URL(currentOrigin)

    if (!isLoopbackHostname(currentUrl.hostname)) {
      url.protocol = currentUrl.protocol
      url.hostname = currentUrl.hostname
    }
  }

  return normalizeUrl(url)
}

function normalizeUrl(url: URL): string {
  if (url.hostname === '127.0.0.1') {
    url.hostname = 'localhost'
  }

  return url.toString().replace(/\/$/, '')
}

function isLocalConvexBackend(url: URL): boolean {
  return url.port === '3210' && isLoopbackHostname(url.hostname)
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}
