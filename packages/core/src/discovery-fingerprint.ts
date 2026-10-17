import type { DiscoveryConnection } from './model-discovery'

/** Binds a discovery preview to its connection configuration without storing secrets. */
export async function discoveryFingerprint(connection: DiscoveryConnection) {
  const encoded = new TextEncoder().encode(
    JSON.stringify([
      connection.id,
      connection.auth ?? 'apiKey',
      connection.baseURL || '',
      connection.extraHeaders || '',
      connection.apiKey || '',
    ]),
  )
  const hash = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
