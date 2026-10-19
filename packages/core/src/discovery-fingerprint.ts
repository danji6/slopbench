import type { DiscoveryConnection } from './model-discovery'
import { sha256 } from './sha256'

/** Binds a discovery preview to its connection configuration without storing secrets. */
export async function discoveryFingerprint(connection: DiscoveryConnection) {
  return sha256(
    JSON.stringify([
      connection.id,
      connection.auth ?? 'apiKey',
      connection.baseURL || '',
      connection.extraHeaders || '',
      connection.apiKey || '',
    ]),
  )
}
