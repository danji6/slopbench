import { error } from '../errors'

/** Creates server-only headers for requests to our sidecar. */
export function sidecarHeaders(initial?: HeadersInit): Headers {
  const secret = process.env.SIDECAR_SECRET
  if (!secret?.trim()) error('SIDECAR_SECRET must be configured', 500)
  const headers = new Headers(initial)
  headers.set('Authorization', `Bearer ${secret}`)
  return headers
}

/** Prevents redirects from forwarding the internal credential to another route. */
export function sidecarRequest(init: RequestInit = {}): RequestInit {
  return { ...init, headers: sidecarHeaders(init.headers), redirect: 'error' }
}
