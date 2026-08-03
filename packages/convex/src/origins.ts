// Origin rules shared by the auth handler and the HTTP action CORS layer.

export function trustsAllOrigins(): boolean {
  return process.env.TRUST_ALL_ORIGINS === 'true'
}

export function frontendUrl(): string {
  return process.env.FRONTEND_URL ?? 'http://localhost:5173'
}

/** The origin the browser reaches for auth. */
export function siteUrl(requestUrl: string): string {
  const configured = process.env.SITE_URL
  if (configured && !isLoopbackUrl(configured)) return configured

  return originOf(requestUrl) ?? configured ?? 'http://localhost:3211'
}

export function isAllowedOrigin(origin: string, requestUrl: string): boolean {
  if (trustsAllOrigins()) return true
  if (origin === frontendUrl() || origin === siteUrl(requestUrl)) return true

  return isLocalNetworkUrl(requestUrl) && isSameHost(origin, requestUrl)
}

export function isLocalNetworkUrl(value: string): boolean {
  const hostname = hostnameOf(value)
  if (!hostname) return false

  if (isLoopbackHostname(hostname) || hostname.endsWith('.local')) return true

  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) {
    return false
  }

  const [a, b] = octets
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  )
}

function isSameHost(a: string, b: string): boolean {
  const first = hostnameOf(a)
  return first !== undefined && first === hostnameOf(b)
}

function isLoopbackUrl(value: string): boolean {
  const hostname = hostnameOf(value)
  return hostname !== undefined && isLoopbackHostname(hostname)
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  )
}

function hostnameOf(value: string): string | undefined {
  return parse(value)?.hostname
}

function originOf(value: string): string | undefined {
  return parse(value)?.origin
}

function parse(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}
